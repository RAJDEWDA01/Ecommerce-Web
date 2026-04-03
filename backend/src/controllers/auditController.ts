import type { Request, Response } from 'express';
import env from '../config/env.js';
import AuditLog, { type AuditOutcome } from '../models/AuditLog.js';
import { logAuditEvent } from '../utils/audit.js';
import {
  getAuditAlertMonitorStatus,
  runAuditAlertMonitorNow,
} from '../services/auditAlertMonitor.js';
import {
  getAuditRetentionStatus,
  runAuditRetentionNow,
} from '../services/auditRetention.js';

interface AuditLogsQuery {
  action?: string;
  actorId?: string;
  actorRole?: 'admin' | 'customer' | 'system' | 'anonymous';
  outcome?: AuditOutcome;
  search?: string;
  fromDate?: string;
  toDate?: string;
  page?: string;
  limit?: string;
}

interface AuditAnalyticsQuery extends AuditLogsQuery {
  days?: string;
  top?: string;
}

interface AuditAlertStatusQuery {
  action?: string;
  actorId?: string;
  actorRole?: 'admin' | 'customer' | 'system' | 'anonymous';
  search?: string;
  windowMinutes?: string;
  minEvents?: string;
  warningFailureRate?: string;
  criticalFailureRate?: string;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_EXPORT_LIMIT = 1000;
const MAX_EXPORT_LIMIT = 5000;
const DEFAULT_ANALYTICS_DAYS = 7;
const MAX_ANALYTICS_DAYS = 90;
const DEFAULT_ANALYTICS_TOP = 5;
const MAX_ANALYTICS_TOP = 20;
const MIN_ALERT_WINDOW_MINUTES = 1;
const MAX_ALERT_WINDOW_MINUTES = 1440;
const MIN_ALERT_MIN_EVENTS = 1;
const MAX_ALERT_MIN_EVENTS = 100000;

const parsePositiveInteger = (raw: unknown, fallback: number): number => {
  if (raw === undefined || raw === null) {
    return fallback;
  }

  const normalized = String(raw).trim();

  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const parseOptionalBoundedInteger = (
  raw: unknown,
  key: string,
  min: number,
  max: number
): { value: number | null; error?: string } => {
  if (raw === undefined || raw === null) {
    return { value: null };
  }

  const normalized = String(raw).trim();

  if (!normalized) {
    return { value: null };
  }

  const parsed = Number(normalized);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return {
      value: null,
      error: `${key} must be an integer between ${min} and ${max}`,
    };
  }

  return { value: parsed };
};

const parseOptionalBoundedNumber = (
  raw: unknown,
  key: string,
  min: number,
  max: number
): { value: number | null; error?: string } => {
  if (raw === undefined || raw === null) {
    return { value: null };
  }

  const normalized = String(raw).trim();

  if (!normalized) {
    return { value: null };
  }

  const parsed = Number(normalized);

  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    return {
      value: null,
      error: `${key} must be a number between ${min} and ${max}`,
    };
  }

  return { value: parsed };
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const parseDate = (
  raw: unknown,
  options?: {
    endOfDay?: boolean;
  }
): Date | null | 'invalid' => {
  if (raw === undefined || raw === null) {
    return null;
  }

  const normalized = String(raw).trim();

  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    return 'invalid';
  }

  if (DATE_ONLY_PATTERN.test(normalized)) {
    if (options?.endOfDay) {
      parsed.setUTCHours(23, 59, 59, 999);
    } else {
      parsed.setUTCHours(0, 0, 0, 0);
    }
  }

  return parsed;
};

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const buildAuditFilters = (
  query: AuditLogsQuery
): { filters: Record<string, unknown> | null; error?: string } => {
  const filters: Record<string, unknown> = {};

  if (query.action?.trim()) {
    filters.action = query.action.trim();
  }

  if (query.actorId?.trim()) {
    filters.actorId = query.actorId.trim();
  }

  if (query.actorRole?.trim()) {
    const role = query.actorRole.trim().toLowerCase();

    if (!['admin', 'customer', 'system', 'anonymous'].includes(role)) {
      return {
        filters: null,
        error: 'actorRole must be one of: admin, customer, system, anonymous',
      };
    }

    filters.actorRole = role;
  }

  if (query.outcome?.trim()) {
    const outcome = query.outcome.trim().toLowerCase();

    if (outcome !== 'success' && outcome !== 'failure') {
      return {
        filters: null,
        error: 'outcome must be one of: success, failure',
      };
    }

    filters.outcome = outcome;
  }

  const fromDate = parseDate(query.fromDate);
  const toDate = parseDate(query.toDate, { endOfDay: true });

  if (fromDate === 'invalid' || toDate === 'invalid') {
    return {
      filters: null,
      error: 'fromDate/toDate must be valid dates',
    };
  }

  if (fromDate || toDate) {
    filters.createdAt = {
      ...(fromDate ? { $gte: fromDate } : {}),
      ...(toDate ? { $lte: toDate } : {}),
    };
  }

  const search = query.search?.trim();

  if (search) {
    const regex = new RegExp(escapeRegExp(search), 'i');
    filters.$or = [
      { action: { $regex: regex } },
      { actorEmail: { $regex: regex } },
      { resourceType: { $regex: regex } },
      { resourceId: { $regex: regex } },
      { requestId: { $regex: regex } },
    ];
  }

  return { filters };
};

interface AnalyticsWindow {
  fromDate: Date;
  toDate: Date;
  days: number;
}

interface AuditAlertOptions {
  windowMinutes: number;
  minEvents: number;
  warningFailureRate: number;
  criticalFailureRate: number;
}

const resolveAnalyticsWindow = (
  query: AuditAnalyticsQuery
): { window: AnalyticsWindow | null; error?: string } => {
  const requestedDays = Math.min(
    parsePositiveInteger(query.days, DEFAULT_ANALYTICS_DAYS),
    MAX_ANALYTICS_DAYS
  );
  const parsedFromDate = parseDate(query.fromDate);
  const parsedToDate = parseDate(query.toDate, { endOfDay: true });

  if (parsedFromDate === 'invalid' || parsedToDate === 'invalid') {
    return {
      window: null,
      error: 'fromDate/toDate must be valid dates',
    };
  }

  const now = new Date();
  const toDate = parsedToDate ?? now;
  const fromDate = (() => {
    if (parsedFromDate) {
      return parsedFromDate;
    }

    const derived = new Date(toDate);
    derived.setUTCDate(derived.getUTCDate() - (requestedDays - 1));
    derived.setUTCHours(0, 0, 0, 0);
    return derived;
  })();

  if (fromDate > toDate) {
    return {
      window: null,
      error: 'fromDate must be less than or equal to toDate',
    };
  }

  const msInDay = 1000 * 60 * 60 * 24;
  const daySpan = Math.ceil((toDate.getTime() - fromDate.getTime() + 1) / msInDay);

  if (daySpan > MAX_ANALYTICS_DAYS) {
    return {
      window: null,
      error: `Date range cannot exceed ${MAX_ANALYTICS_DAYS} days`,
    };
  }

  return {
    window: {
      fromDate,
      toDate,
      days: daySpan,
    },
  };
};

const resolveAuditAlertOptions = (
  query: AuditAlertStatusQuery
): { options: AuditAlertOptions | null; error?: string } => {
  const windowMinutesResult = parseOptionalBoundedInteger(
    query.windowMinutes,
    'windowMinutes',
    MIN_ALERT_WINDOW_MINUTES,
    MAX_ALERT_WINDOW_MINUTES
  );

  if (windowMinutesResult.error) {
    return { options: null, error: windowMinutesResult.error };
  }

  const minEventsResult = parseOptionalBoundedInteger(
    query.minEvents,
    'minEvents',
    MIN_ALERT_MIN_EVENTS,
    MAX_ALERT_MIN_EVENTS
  );

  if (minEventsResult.error) {
    return { options: null, error: minEventsResult.error };
  }

  const warningFailureRateResult = parseOptionalBoundedNumber(
    query.warningFailureRate,
    'warningFailureRate',
    0,
    100
  );

  if (warningFailureRateResult.error) {
    return { options: null, error: warningFailureRateResult.error };
  }

  const criticalFailureRateResult = parseOptionalBoundedNumber(
    query.criticalFailureRate,
    'criticalFailureRate',
    0,
    100
  );

  if (criticalFailureRateResult.error) {
    return { options: null, error: criticalFailureRateResult.error };
  }

  const warningFailureRate =
    warningFailureRateResult.value ?? env.auditAlertWarningFailureRate;
  const criticalFailureRate =
    criticalFailureRateResult.value ?? env.auditAlertCriticalFailureRate;

  if (criticalFailureRate < warningFailureRate) {
    return {
      options: null,
      error: 'criticalFailureRate must be greater than or equal to warningFailureRate',
    };
  }

  return {
    options: {
      windowMinutes: windowMinutesResult.value ?? env.auditAlertWindowMinutes,
      minEvents: minEventsResult.value ?? env.auditAlertMinEvents,
      warningFailureRate,
      criticalFailureRate,
    },
  };
};

const enumerateUtcDays = (fromDate: Date, toDate: Date): string[] => {
  const days: string[] = [];
  const cursor = new Date(fromDate);
  cursor.setUTCHours(0, 0, 0, 0);

  const normalizedToDate = new Date(toDate);
  normalizedToDate.setUTCHours(0, 0, 0, 0);

  while (cursor <= normalizedToDate) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
};

const csvEscape = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue =
    typeof value === 'object' ? JSON.stringify(value) : String(value);

  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
};

const toAuditCsv = (auditLogs: Array<Record<string, unknown>>): string => {
  const headers = [
    'createdAt',
    'action',
    'outcome',
    'actorRole',
    'actorId',
    'actorEmail',
    'resourceType',
    'resourceId',
    'requestId',
    'method',
    'path',
    'statusCode',
    'ipAddress',
    'userAgent',
    'metadata',
  ];

  const rows = auditLogs.map((log) =>
    headers
      .map((header) => {
        if (header === 'metadata') {
          return csvEscape(log.metadata ?? null);
        }

        return csvEscape(log[header]);
      })
      .join(',')
  );

  return `${headers.join(',')}\n${rows.join('\n')}`;
};

export const getAuditLogs = async (
  req: Request<unknown, unknown, unknown, AuditLogsQuery>,
  res: Response
): Promise<void> => {
  try {
    const page = parsePositiveInteger(req.query.page, DEFAULT_PAGE);
    const limit = Math.min(parsePositiveInteger(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const skip = (page - 1) * limit;

    const filterResult = buildAuditFilters(req.query);

    if (!filterResult.filters) {
      res.status(400).json({ success: false, message: filterResult.error || 'Invalid filters' });
      return;
    }

    const [auditLogs, totalCount] = await Promise.all([
      AuditLog.find(filterResult.filters).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(filterResult.filters),
    ]);

    const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / limit);

    res.status(200).json({
      success: true,
      count: auditLogs.length,
      totalCount,
      auditLogs,
      pagination: {
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1 && totalPages > 0,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch audit logs' });
  }
};

export const exportAuditLogsCsv = async (
  req: Request<unknown, unknown, unknown, AuditLogsQuery>,
  res: Response
): Promise<void> => {
  try {
    const filterResult = buildAuditFilters(req.query);

    if (!filterResult.filters) {
      res.status(400).json({ success: false, message: filterResult.error || 'Invalid filters' });
      return;
    }

    const limit = Math.min(
      parsePositiveInteger(req.query.limit, DEFAULT_EXPORT_LIMIT),
      MAX_EXPORT_LIMIT
    );

    const auditLogs = await AuditLog.find(filterResult.filters)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const csvRows: Array<Record<string, unknown>> = auditLogs.map((log) => ({
      createdAt: log.createdAt,
      action: log.action,
      outcome: log.outcome,
      actorRole: log.actorRole,
      actorId: log.actorId,
      actorEmail: log.actorEmail,
      resourceType: log.resourceType,
      resourceId: log.resourceId,
      requestId: log.requestId,
      method: log.method,
      path: log.path,
      statusCode: log.statusCode,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      metadata: log.metadata,
    }));

    const csv = toAuditCsv(csvRows);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `audit-logs-${timestamp}.csv`;

    await logAuditEvent(req, {
      action: 'audit.logs.export',
      outcome: 'success',
      statusCode: 200,
      resourceType: 'audit_log',
      metadata: {
        exportedCount: auditLogs.length,
        requestedLimit: limit,
      },
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);
  } catch (error) {
    await logAuditEvent(req, {
      action: 'audit.logs.export',
      outcome: 'failure',
      statusCode: 500,
      resourceType: 'audit_log',
      metadata: { reason: 'unexpected_error' },
    });

    res.status(500).json({ success: false, message: 'Failed to export audit logs' });
  }
};

export const getAuditAnalytics = async (
  req: Request<unknown, unknown, unknown, AuditAnalyticsQuery>,
  res: Response
): Promise<void> => {
  try {
    const filterResult = buildAuditFilters(req.query);

    if (!filterResult.filters) {
      res.status(400).json({ success: false, message: filterResult.error || 'Invalid filters' });
      return;
    }

    const windowResult = resolveAnalyticsWindow(req.query);

    if (!windowResult.window) {
      res.status(400).json({ success: false, message: windowResult.error || 'Invalid date range' });
      return;
    }

    const top = Math.min(parsePositiveInteger(req.query.top, DEFAULT_ANALYTICS_TOP), MAX_ANALYTICS_TOP);

    const analyticsFilters: Record<string, unknown> = { ...filterResult.filters };
    const existingCreatedAt =
      analyticsFilters.createdAt && typeof analyticsFilters.createdAt === 'object'
        ? (analyticsFilters.createdAt as Record<string, unknown>)
        : {};

    analyticsFilters.createdAt = {
      ...existingCreatedAt,
      $gte: windowResult.window.fromDate,
      $lte: windowResult.window.toDate,
    };

    const failureFilters = { ...analyticsFilters, outcome: 'failure' };
    const successFilters = { ...analyticsFilters, outcome: 'success' };
    const actorsFilters = {
      ...analyticsFilters,
      actorId: { $nin: [null, ''] },
    };

    const [totalCount, failureCount, successCount, distinctActors, byDayRaw, topActionsRaw, topActorsRaw] =
      await Promise.all([
        AuditLog.countDocuments(analyticsFilters),
        AuditLog.countDocuments(failureFilters),
        AuditLog.countDocuments(successFilters),
        AuditLog.distinct('actorId', actorsFilters),
        AuditLog.aggregate<{ _id: string; total: number; success: number; failure: number }>([
          { $match: analyticsFilters },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$createdAt',
                },
              },
              total: { $sum: 1 },
              success: {
                $sum: {
                  $cond: [{ $eq: ['$outcome', 'success'] }, 1, 0],
                },
              },
              failure: {
                $sum: {
                  $cond: [{ $eq: ['$outcome', 'failure'] }, 1, 0],
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ]),
        AuditLog.aggregate<{ _id: string; total: number; success: number; failure: number }>([
          { $match: analyticsFilters },
          {
            $group: {
              _id: '$action',
              total: { $sum: 1 },
              success: {
                $sum: {
                  $cond: [{ $eq: ['$outcome', 'success'] }, 1, 0],
                },
              },
              failure: {
                $sum: {
                  $cond: [{ $eq: ['$outcome', 'failure'] }, 1, 0],
                },
              },
            },
          },
          { $sort: { total: -1, _id: 1 } },
          { $limit: top },
        ]),
        AuditLog.aggregate<{
          _id: { actorId: string | null; actorEmail: string | null; actorRole: string | null };
          total: number;
        }>([
          { $match: analyticsFilters },
          {
            $group: {
              _id: {
                actorId: '$actorId',
                actorEmail: '$actorEmail',
                actorRole: '$actorRole',
              },
              total: { $sum: 1 },
            },
          },
          { $sort: { total: -1 } },
          { $limit: top },
        ]),
      ]);

    const byDayMap = new Map(
      byDayRaw.map((entry) => [
        entry._id,
        {
          total: entry.total,
          success: entry.success,
          failure: entry.failure,
        },
      ])
    );

    const byDay = enumerateUtcDays(windowResult.window.fromDate, windowResult.window.toDate).map((date) => {
      const entry = byDayMap.get(date);
      return {
        date,
        total: entry?.total ?? 0,
        success: entry?.success ?? 0,
        failure: entry?.failure ?? 0,
      };
    });

    const topActions = topActionsRaw.map((entry) => ({
      action: entry._id,
      total: entry.total,
      success: entry.success,
      failure: entry.failure,
    }));

    const topActors = topActorsRaw.map((entry) => ({
      actorId: entry._id.actorId,
      actorEmail: entry._id.actorEmail,
      actorRole: entry._id.actorRole,
      total: entry.total,
    }));

    const failureRate = totalCount === 0 ? 0 : Number(((failureCount / totalCount) * 100).toFixed(2));

    res.status(200).json({
      success: true,
      analytics: {
        window: {
          fromDate: windowResult.window.fromDate.toISOString(),
          toDate: windowResult.window.toDate.toISOString(),
          days: windowResult.window.days,
        },
        totals: {
          totalCount,
          successCount,
          failureCount,
          uniqueActors: distinctActors.length,
          failureRate,
        },
        byDay,
        topActions,
        topActors,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch audit analytics' });
  }
};

export const getAuditAlertStatus = async (
  req: Request<unknown, unknown, unknown, AuditAlertStatusQuery>,
  res: Response
): Promise<void> => {
  try {
    const filterResult = buildAuditFilters(req.query);

    if (!filterResult.filters) {
      res.status(400).json({ success: false, message: filterResult.error || 'Invalid filters' });
      return;
    }

    const optionsResult = resolveAuditAlertOptions(req.query);

    if (!optionsResult.options) {
      res.status(400).json({ success: false, message: optionsResult.error || 'Invalid alert options' });
      return;
    }

    const options = optionsResult.options;
    const now = new Date();
    const fromDate = new Date(now.getTime() - options.windowMinutes * 60 * 1000);
    const alertFilters: Record<string, unknown> = { ...filterResult.filters };
    delete alertFilters.createdAt;

    alertFilters.createdAt = {
      $gte: fromDate,
      $lte: now,
    };

    const [totalCount, failureCount, topFailingActionsRaw] = await Promise.all([
      AuditLog.countDocuments(alertFilters),
      AuditLog.countDocuments({ ...alertFilters, outcome: 'failure' }),
      AuditLog.aggregate<{ _id: string; failureCount: number }>([
        {
          $match: {
            ...alertFilters,
            outcome: 'failure',
          },
        },
        {
          $group: {
            _id: '$action',
            failureCount: { $sum: 1 },
          },
        },
        { $sort: { failureCount: -1, _id: 1 } },
        { $limit: 5 },
      ]),
    ]);

    const successCount = Math.max(0, totalCount - failureCount);
    const failureRate = totalCount === 0 ? 0 : Number(((failureCount / totalCount) * 100).toFixed(2));

    const severity =
      totalCount < options.minEvents
        ? 'ok'
        : failureRate >= options.criticalFailureRate
          ? 'critical'
          : failureRate >= options.warningFailureRate
            ? 'warning'
            : 'ok';

    const reason =
      totalCount < options.minEvents
        ? `insufficient_events: minimum ${options.minEvents} events required`
        : severity === 'critical'
          ? 'critical_threshold_exceeded'
          : severity === 'warning'
            ? 'warning_threshold_exceeded'
            : 'healthy';

    const topFailingActions = topFailingActionsRaw.map((entry) => ({
      action: entry._id,
      failureCount: entry.failureCount,
    }));

    res.status(200).json({
      success: true,
      alert: {
        generatedAt: now.toISOString(),
        severity,
        reason,
        triggered: severity !== 'ok',
        window: {
          fromDate: fromDate.toISOString(),
          toDate: now.toISOString(),
          minutes: options.windowMinutes,
        },
        thresholds: {
          minEvents: options.minEvents,
          warningFailureRate: options.warningFailureRate,
          criticalFailureRate: options.criticalFailureRate,
        },
        metrics: {
          totalCount,
          successCount,
          failureCount,
          failureRate,
        },
        topFailingActions,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to evaluate audit alert status' });
  }
};

export const getAuditAlertNotifierHealth = (_req: Request, res: Response): void => {
  const status = getAuditAlertMonitorStatus();

  res.status(200).json({
    success: true,
    notifier: {
      ...status,
      startedAt: status.startedAt?.toISOString() ?? null,
      lastRunAt: status.lastRunAt?.toISOString() ?? null,
      lastSuccessAt: status.lastSuccessAt?.toISOString() ?? null,
      nextRunAt: status.nextRunAt?.toISOString() ?? null,
      lastNotificationAt: status.lastNotificationAt?.toISOString() ?? null,
    },
  });
};

export const runAuditAlertNotifierNowHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  const result = await runAuditAlertMonitorNow();

  if (!result) {
    await logAuditEvent(req, {
      action: 'audit.alert.notifier.run_manual',
      outcome: 'failure',
      statusCode: 409,
      resourceType: 'audit_log',
      metadata: { reason: 'notifier_disabled' },
    });

    res.status(409).json({
      success: false,
      message: 'Audit alert notifier is not active in this environment.',
    });
    return;
  }

  if (result.skipped) {
    await logAuditEvent(req, {
      action: 'audit.alert.notifier.run_manual',
      outcome: 'failure',
      statusCode: 409,
      resourceType: 'audit_log',
      metadata: { reason: result.reason ?? 'skipped' },
    });

    res.status(409).json({
      success: false,
      message: 'Alert notifier is already running. Try again shortly.',
      result: {
        ...result,
        startedAt: result.startedAt.toISOString(),
        finishedAt: result.finishedAt.toISOString(),
        evaluation: result.evaluation
          ? {
              ...result.evaluation,
              generatedAt: result.evaluation.generatedAt.toISOString(),
              window: {
                ...result.evaluation.window,
                fromDate: result.evaluation.window.fromDate.toISOString(),
                toDate: result.evaluation.window.toDate.toISOString(),
              },
            }
          : null,
      },
    });
    return;
  }

  if (!result.ran) {
    await logAuditEvent(req, {
      action: 'audit.alert.notifier.run_manual',
      outcome: 'failure',
      statusCode: 500,
      resourceType: 'audit_log',
      metadata: { reason: result.reason ?? 'run_failed' },
    });

    res.status(500).json({
      success: false,
      message: 'Manual alert notifier run failed.',
      result: {
        ...result,
        startedAt: result.startedAt.toISOString(),
        finishedAt: result.finishedAt.toISOString(),
      },
    });
    return;
  }

  await logAuditEvent(req, {
    action: 'audit.alert.notifier.run_manual',
    outcome: 'success',
    statusCode: 200,
    resourceType: 'audit_log',
    metadata: {
      severity: result.evaluation?.severity ?? null,
      failureRate: result.evaluation?.metrics.failureRate ?? null,
      notified: result.notification?.sent ?? false,
      notificationReason: result.notification?.reason ?? null,
      durationMs: result.durationMs,
    },
  });

  res.status(200).json({
    success: true,
    message: 'Manual alert notifier run completed.',
    result: {
      ...result,
      startedAt: result.startedAt.toISOString(),
      finishedAt: result.finishedAt.toISOString(),
      evaluation: result.evaluation
        ? {
            ...result.evaluation,
            generatedAt: result.evaluation.generatedAt.toISOString(),
            window: {
              ...result.evaluation.window,
              fromDate: result.evaluation.window.fromDate.toISOString(),
              toDate: result.evaluation.window.toDate.toISOString(),
            },
          }
        : null,
    },
  });
};

export const getAuditRetentionHealth = (_req: Request, res: Response): void => {
  const status = getAuditRetentionStatus();

  res.status(200).json({
    success: true,
    retention: {
      ...status,
      startedAt: status.startedAt?.toISOString() ?? null,
      lastRunAt: status.lastRunAt?.toISOString() ?? null,
      lastSuccessAt: status.lastSuccessAt?.toISOString() ?? null,
      nextRunAt: status.nextRunAt?.toISOString() ?? null,
      lastCutoff: status.lastCutoff?.toISOString() ?? null,
    },
  });
};

export const runAuditRetentionNowHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  const result = await runAuditRetentionNow();

  if (!result) {
    await logAuditEvent(req, {
      action: 'audit.retention.run_manual',
      outcome: 'failure',
      statusCode: 409,
      resourceType: 'audit_log',
      metadata: { reason: 'retention_disabled' },
    });

    res.status(409).json({
      success: false,
      message: 'Audit retention job is not active in this environment.',
    });
    return;
  }

  if (result.skipped) {
    await logAuditEvent(req, {
      action: 'audit.retention.run_manual',
      outcome: 'failure',
      statusCode: 409,
      resourceType: 'audit_log',
      metadata: { reason: result.reason ?? 'skipped' },
    });

    res.status(409).json({
      success: false,
      message: 'Retention job is already running. Try again shortly.',
      result: {
        ...result,
        startedAt: result.startedAt.toISOString(),
        finishedAt: result.finishedAt.toISOString(),
        cutoff: result.cutoff?.toISOString() ?? null,
      },
    });
    return;
  }

  if (!result.ran) {
    await logAuditEvent(req, {
      action: 'audit.retention.run_manual',
      outcome: 'failure',
      statusCode: 500,
      resourceType: 'audit_log',
      metadata: { reason: result.reason ?? 'run_failed' },
    });

    res.status(500).json({
      success: false,
      message: 'Manual retention run failed.',
      result: {
        ...result,
        startedAt: result.startedAt.toISOString(),
        finishedAt: result.finishedAt.toISOString(),
        cutoff: result.cutoff?.toISOString() ?? null,
      },
    });
    return;
  }

  await logAuditEvent(req, {
    action: 'audit.retention.run_manual',
    outcome: 'success',
    statusCode: 200,
    resourceType: 'audit_log',
    metadata: {
      deletedCount: result.deletedCount,
      durationMs: result.durationMs,
      cutoff: result.cutoff?.toISOString() ?? null,
    },
  });

  res.status(200).json({
    success: true,
    message: 'Manual retention run completed.',
    result: {
      ...result,
      startedAt: result.startedAt.toISOString(),
      finishedAt: result.finishedAt.toISOString(),
      cutoff: result.cutoff?.toISOString() ?? null,
    },
  });
};
