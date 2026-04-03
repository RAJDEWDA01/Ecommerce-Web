import type { Request, Response } from 'express';
import AdminNotificationDelivery from '../models/AdminNotificationDelivery.js';
import { logAuditEvent } from '../utils/audit.js';
import {
  getAdminNotificationRetryStatus,
  runAdminNotificationRetryNow,
} from '../services/adminNotificationRetry.js';
import {
  getAdminNotificationRetentionStatus,
  runAdminNotificationRetentionNow,
} from '../services/adminNotificationRetention.js';

interface NotificationDeliveriesQuery {
  status?: 'sent' | 'failed' | 'retrying' | 'skipped';
  eventType?: 'order' | 'payment' | 'support' | 'feedback';
  search?: string;
  fromDate?: string;
  toDate?: string;
  retryableOnly?: string;
  page?: string;
  limit?: string;
}

interface NotificationAnalyticsQuery {
  eventType?: 'order' | 'payment' | 'support' | 'feedback';
  days?: string;
  fromDate?: string;
  toDate?: string;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_ANALYTICS_DAYS = 14;
const MAX_ANALYTICS_DAYS = 365;
const DELIVERY_STATUSES = ['sent', 'failed', 'retrying', 'skipped'] as const;
const EVENT_TYPES = ['order', 'payment', 'support', 'feedback'] as const;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

const parseBooleanFlag = (raw: unknown): boolean => {
  if (raw === undefined || raw === null) {
    return false;
  }

  const normalized = String(raw).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const parseBoundedInteger = (raw: unknown, fallback: number, min: number, max: number): number => {
  if (raw === undefined || raw === null) {
    return fallback;
  }

  const normalized = String(raw).trim();

  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }

  return parsed;
};

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

export const getAdminNotificationDeliveryAnalytics = async (
  req: Request<unknown, unknown, unknown, NotificationAnalyticsQuery>,
  res: Response
): Promise<void> => {
  try {
    const eventType = req.query.eventType?.trim().toLowerCase();

    if (eventType && !EVENT_TYPES.includes(eventType as (typeof EVENT_TYPES)[number])) {
      res.status(400).json({
        success: false,
        message: `eventType must be one of: ${EVENT_TYPES.join(', ')}`,
      });
      return;
    }

    const days = parseBoundedInteger(req.query.days, DEFAULT_ANALYTICS_DAYS, 1, MAX_ANALYTICS_DAYS);
    const now = new Date();
    const fallbackFromDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const parsedFromDate = parseDate(req.query.fromDate);
    const parsedToDate = parseDate(req.query.toDate, { endOfDay: true });

    if (parsedFromDate === 'invalid' || parsedToDate === 'invalid') {
      res.status(400).json({
        success: false,
        message: 'fromDate/toDate must be valid dates',
      });
      return;
    }

    const fromDate = parsedFromDate ?? fallbackFromDate;
    const toDate = parsedToDate ?? now;

    if (fromDate > toDate) {
      res.status(400).json({
        success: false,
        message: 'fromDate cannot be after toDate',
      });
      return;
    }

    const filters: Record<string, unknown> = {
      createdAt: {
        $gte: fromDate,
        $lte: toDate,
      },
    };

    if (eventType) {
      filters.eventType = eventType;
    }

    const [summaryRaw, byEventTypeRaw, dailyTrendRaw] = await Promise.all([
      AdminNotificationDelivery.aggregate<{
        totalCount: number;
        sentCount: number;
        failedCount: number;
        retryingCount: number;
        skippedCount: number;
      }>([
        { $match: filters },
        {
          $group: {
            _id: null,
            totalCount: { $sum: 1 },
            sentCount: {
              $sum: {
                $cond: [{ $eq: ['$status', 'sent'] }, 1, 0],
              },
            },
            failedCount: {
              $sum: {
                $cond: [{ $eq: ['$status', 'failed'] }, 1, 0],
              },
            },
            retryingCount: {
              $sum: {
                $cond: [{ $eq: ['$status', 'retrying'] }, 1, 0],
              },
            },
            skippedCount: {
              $sum: {
                $cond: [{ $eq: ['$status', 'skipped'] }, 1, 0],
              },
            },
          },
        },
      ]),
      AdminNotificationDelivery.aggregate<{
        _id: string;
        totalCount: number;
        sentCount: number;
        failedCount: number;
        retryingCount: number;
        skippedCount: number;
        lastCreatedAt: Date | null;
      }>([
        { $match: filters },
        {
          $group: {
            _id: '$eventType',
            totalCount: { $sum: 1 },
            sentCount: {
              $sum: {
                $cond: [{ $eq: ['$status', 'sent'] }, 1, 0],
              },
            },
            failedCount: {
              $sum: {
                $cond: [{ $eq: ['$status', 'failed'] }, 1, 0],
              },
            },
            retryingCount: {
              $sum: {
                $cond: [{ $eq: ['$status', 'retrying'] }, 1, 0],
              },
            },
            skippedCount: {
              $sum: {
                $cond: [{ $eq: ['$status', 'skipped'] }, 1, 0],
              },
            },
            lastCreatedAt: { $max: '$createdAt' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      AdminNotificationDelivery.aggregate<{
        _id: string;
        totalCount: number;
        sentCount: number;
        failedCount: number;
        retryingCount: number;
        skippedCount: number;
      }>([
        { $match: filters },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt',
              },
            },
            totalCount: { $sum: 1 },
            sentCount: {
              $sum: {
                $cond: [{ $eq: ['$status', 'sent'] }, 1, 0],
              },
            },
            failedCount: {
              $sum: {
                $cond: [{ $eq: ['$status', 'failed'] }, 1, 0],
              },
            },
            retryingCount: {
              $sum: {
                $cond: [{ $eq: ['$status', 'retrying'] }, 1, 0],
              },
            },
            skippedCount: {
              $sum: {
                $cond: [{ $eq: ['$status', 'skipped'] }, 1, 0],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const summary = summaryRaw[0] ?? {
      totalCount: 0,
      sentCount: 0,
      failedCount: 0,
      retryingCount: 0,
      skippedCount: 0,
    };

    const sentRate =
      summary.totalCount === 0
        ? 0
        : Math.round((summary.sentCount / summary.totalCount) * 10000) / 100;

    res.status(200).json({
      success: true,
      window: {
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
        days,
      },
      summary: {
        ...summary,
        sentRate,
      },
      byEventType: byEventTypeRaw.map((entry) => ({
        eventType: entry._id,
        totalCount: entry.totalCount,
        sentCount: entry.sentCount,
        failedCount: entry.failedCount,
        retryingCount: entry.retryingCount,
        skippedCount: entry.skippedCount,
        lastCreatedAt: entry.lastCreatedAt ? entry.lastCreatedAt.toISOString() : null,
      })),
      dailyTrend: dailyTrendRaw.map((entry) => ({
        date: entry._id,
        totalCount: entry.totalCount,
        sentCount: entry.sentCount,
        failedCount: entry.failedCount,
        retryingCount: entry.retryingCount,
        skippedCount: entry.skippedCount,
      })),
    });
  } catch (error) {
    console.error('Error fetching admin notification delivery analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin notification delivery analytics',
    });
  }
};

export const getAdminNotificationDeliveries = async (
  req: Request<unknown, unknown, unknown, NotificationDeliveriesQuery>,
  res: Response
): Promise<void> => {
  try {
    const page = parsePositiveInteger(req.query.page, DEFAULT_PAGE);
    const limit = Math.min(parsePositiveInteger(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const skip = (page - 1) * limit;

    const status = req.query.status?.trim().toLowerCase();
    const eventType = req.query.eventType?.trim().toLowerCase();
    const retryableOnly = parseBooleanFlag(req.query.retryableOnly);
    const search = req.query.search?.trim();

    if (status && !DELIVERY_STATUSES.includes(status as (typeof DELIVERY_STATUSES)[number])) {
      res.status(400).json({
        success: false,
        message: `status must be one of: ${DELIVERY_STATUSES.join(', ')}`,
      });
      return;
    }

    if (eventType && !EVENT_TYPES.includes(eventType as (typeof EVENT_TYPES)[number])) {
      res.status(400).json({
        success: false,
        message: `eventType must be one of: ${EVENT_TYPES.join(', ')}`,
      });
      return;
    }

    const fromDate = parseDate(req.query.fromDate);
    const toDate = parseDate(req.query.toDate, { endOfDay: true });

    if (fromDate === 'invalid' || toDate === 'invalid') {
      res.status(400).json({
        success: false,
        message: 'fromDate/toDate must be valid dates',
      });
      return;
    }

    if (fromDate && toDate && fromDate > toDate) {
      res.status(400).json({
        success: false,
        message: 'fromDate cannot be after toDate',
      });
      return;
    }

    const filters: Record<string, unknown> = {
      status: status || 'failed',
    };

    if (eventType) {
      filters.eventType = eventType;
    }

    if (fromDate || toDate) {
      filters.createdAt = {
        ...(fromDate ? { $gte: fromDate } : {}),
        ...(toDate ? { $lte: toDate } : {}),
      };
    }

    if (search) {
      const safeSearch = escapeRegExp(search);
      const regex = { $regex: safeSearch, $options: 'i' };
      filters.$or = [{ subject: regex }, { recipients: regex }, { failureReason: regex }];
    }

    if (retryableOnly) {
      filters.nextRetryAt = { $ne: null };
      filters.$expr = { $lt: ['$attempts', '$maxAttempts'] };
    }

    const [deliveries, totalCount, failedCount, retryableFailedCount] = await Promise.all([
      AdminNotificationDelivery.find(filters)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select(
          'eventType subject recipients status skipReason failureReason attempts maxAttempts nextRetryAt lastAttemptAt sentAt createdAt updatedAt'
        )
        .lean(),
      AdminNotificationDelivery.countDocuments(filters),
      AdminNotificationDelivery.countDocuments({ status: 'failed' }),
      AdminNotificationDelivery.countDocuments({
        status: 'failed',
        nextRetryAt: { $ne: null },
        $expr: { $lt: ['$attempts', '$maxAttempts'] },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    res.status(200).json({
      success: true,
      deliveries,
      count: deliveries.length,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
      summary: {
        failedCount,
        retryableFailedCount,
      },
    });
  } catch (error) {
    console.error('Error fetching admin notification deliveries:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin notification deliveries',
    });
  }
};

export const getAdminNotificationRetryHealth = (_req: Request, res: Response): void => {
  const status = getAdminNotificationRetryStatus();

  res.status(200).json({
    success: true,
    retry: {
      ...status,
      startedAt: status.startedAt?.toISOString() ?? null,
      lastRunAt: status.lastRunAt?.toISOString() ?? null,
      lastSuccessAt: status.lastSuccessAt?.toISOString() ?? null,
      nextRunAt: status.nextRunAt?.toISOString() ?? null,
    },
  });
};

export const runAdminNotificationRetryNowHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  const result = await runAdminNotificationRetryNow();

  if (!result) {
    await logAuditEvent(req, {
      action: 'notifications.retry.run_manual',
      outcome: 'failure',
      statusCode: 409,
      resourceType: 'notification_delivery',
      metadata: { reason: 'retry_job_disabled' },
    });

    res.status(409).json({
      success: false,
      message: 'Notification retry job is not active in this environment.',
    });
    return;
  }

  if (result.skipped) {
    await logAuditEvent(req, {
      action: 'notifications.retry.run_manual',
      outcome: 'failure',
      statusCode: 409,
      resourceType: 'notification_delivery',
      metadata: { reason: result.reason ?? 'skipped' },
    });

    res.status(409).json({
      success: false,
      message: 'Notification retry job is already running. Try again shortly.',
      result: {
        ...result,
        startedAt: result.startedAt.toISOString(),
        finishedAt: result.finishedAt.toISOString(),
      },
    });
    return;
  }

  if (!result.ran) {
    await logAuditEvent(req, {
      action: 'notifications.retry.run_manual',
      outcome: 'failure',
      statusCode: 500,
      resourceType: 'notification_delivery',
      metadata: { reason: result.reason ?? 'run_failed' },
    });

    res.status(500).json({
      success: false,
      message: 'Manual notification retry run failed.',
      result: {
        ...result,
        startedAt: result.startedAt.toISOString(),
        finishedAt: result.finishedAt.toISOString(),
      },
    });
    return;
  }

  await logAuditEvent(req, {
    action: 'notifications.retry.run_manual',
    outcome: 'success',
    statusCode: 200,
    resourceType: 'notification_delivery',
    metadata: {
      processedCount: result.processedCount,
      sentCount: result.sentCount,
      failedCount: result.failedCount,
      durationMs: result.durationMs,
    },
  });

  res.status(200).json({
    success: true,
    message: 'Manual notification retry run completed.',
    result: {
      ...result,
      startedAt: result.startedAt.toISOString(),
      finishedAt: result.finishedAt.toISOString(),
    },
  });
};

export const getAdminNotificationRetentionHealth = (_req: Request, res: Response): void => {
  const status = getAdminNotificationRetentionStatus();

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

export const runAdminNotificationRetentionNowHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  const result = await runAdminNotificationRetentionNow();

  if (!result) {
    await logAuditEvent(req, {
      action: 'notifications.retention.run_manual',
      outcome: 'failure',
      statusCode: 409,
      resourceType: 'notification_delivery',
      metadata: { reason: 'retention_job_disabled' },
    });

    res.status(409).json({
      success: false,
      message: 'Notification retention job is not active in this environment.',
    });
    return;
  }

  if (result.skipped) {
    await logAuditEvent(req, {
      action: 'notifications.retention.run_manual',
      outcome: 'failure',
      statusCode: 409,
      resourceType: 'notification_delivery',
      metadata: { reason: result.reason ?? 'skipped' },
    });

    res.status(409).json({
      success: false,
      message: 'Notification retention job is already running. Try again shortly.',
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
      action: 'notifications.retention.run_manual',
      outcome: 'failure',
      statusCode: 500,
      resourceType: 'notification_delivery',
      metadata: { reason: result.reason ?? 'run_failed' },
    });

    res.status(500).json({
      success: false,
      message: 'Manual notification retention run failed.',
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
    action: 'notifications.retention.run_manual',
    outcome: 'success',
    statusCode: 200,
    resourceType: 'notification_delivery',
    metadata: {
      deletedCount: result.deletedCount,
      durationMs: result.durationMs,
    },
  });

  res.status(200).json({
    success: true,
    message: 'Manual notification retention run completed.',
    result: {
      ...result,
      startedAt: result.startedAt.toISOString(),
      finishedAt: result.finishedAt.toISOString(),
      cutoff: result.cutoff?.toISOString() ?? null,
    },
  });
};
