import AuditLog from '../models/AuditLog.js';
import { logger } from '../utils/logger.js';

export type AuditAlertSeverity = 'ok' | 'warning' | 'critical';

interface StartAuditAlertMonitorJobOptions {
  enabled: boolean;
  webhookUrl: string | null;
  checkIntervalMinutes: number;
  cooldownMinutes: number;
  webhookTimeoutMs: number;
  windowMinutes: number;
  minEvents: number;
  warningFailureRate: number;
  criticalFailureRate: number;
}

interface AuditAlertEvaluation {
  generatedAt: Date;
  severity: AuditAlertSeverity;
  reason: string;
  window: {
    fromDate: Date;
    toDate: Date;
    minutes: number;
  };
  thresholds: {
    minEvents: number;
    warningFailureRate: number;
    criticalFailureRate: number;
  };
  metrics: {
    totalCount: number;
    successCount: number;
    failureCount: number;
    failureRate: number;
  };
  topFailingActions: Array<{
    action: string;
    failureCount: number;
  }>;
}

interface AuditAlertNotificationResult {
  attempted: boolean;
  sent: boolean;
  reason: string | null;
  statusCode: number | null;
  error: string | null;
}

interface AuditAlertMonitorStatus {
  enabled: boolean;
  webhookConfigured: boolean;
  isRunning: boolean;
  startedAt: Date | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  nextRunAt: Date | null;
  checkIntervalMinutes: number | null;
  cooldownMinutes: number | null;
  webhookTimeoutMs: number | null;
  windowMinutes: number | null;
  minEvents: number | null;
  warningFailureRate: number | null;
  criticalFailureRate: number | null;
  lastRunMode: 'scheduled' | 'manual' | null;
  lastSkipReason: string | null;
  lastError: string | null;
  lastSeverity: AuditAlertSeverity | null;
  lastReason: string | null;
  lastFailureRate: number | null;
  lastTotalCount: number | null;
  lastNotificationAt: Date | null;
  lastNotificationSeverity: AuditAlertSeverity | null;
  lastNotificationReason: string | null;
  lastNotificationStatusCode: number | null;
  lastNotificationError: string | null;
}

interface AuditAlertMonitorRunResult {
  ran: boolean;
  skipped: boolean;
  mode: 'scheduled' | 'manual';
  reason: string | null;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  evaluation: AuditAlertEvaluation | null;
  notification: AuditAlertNotificationResult | null;
}

const monitorStatus: AuditAlertMonitorStatus = {
  enabled: false,
  webhookConfigured: false,
  isRunning: false,
  startedAt: null,
  lastRunAt: null,
  lastSuccessAt: null,
  nextRunAt: null,
  checkIntervalMinutes: null,
  cooldownMinutes: null,
  webhookTimeoutMs: null,
  windowMinutes: null,
  minEvents: null,
  warningFailureRate: null,
  criticalFailureRate: null,
  lastRunMode: null,
  lastSkipReason: null,
  lastError: null,
  lastSeverity: null,
  lastReason: null,
  lastFailureRate: null,
  lastTotalCount: null,
  lastNotificationAt: null,
  lastNotificationSeverity: null,
  lastNotificationReason: null,
  lastNotificationStatusCode: null,
  lastNotificationError: null,
};

let manualRunHandler: (() => Promise<AuditAlertMonitorRunResult>) | null = null;

const evaluateCurrentAlert = async (
  options: StartAuditAlertMonitorJobOptions,
  now: Date
): Promise<AuditAlertEvaluation> => {
  const fromDate = new Date(now.getTime() - options.windowMinutes * 60 * 1000);
  const filters = {
    createdAt: {
      $gte: fromDate,
      $lte: now,
    },
  };

  const [totalCount, failureCount, topFailingActionsRaw] = await Promise.all([
    AuditLog.countDocuments(filters),
    AuditLog.countDocuments({ ...filters, outcome: 'failure' }),
    AuditLog.aggregate<{ _id: string; failureCount: number }>([
      {
        $match: {
          ...filters,
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

  const severity: AuditAlertSeverity =
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

  return {
    generatedAt: now,
    severity,
    reason,
    window: {
      fromDate,
      toDate: now,
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
    topFailingActions: topFailingActionsRaw.map((entry) => ({
      action: entry._id,
      failureCount: entry.failureCount,
    })),
  };
};

const notifyWebhookIfNeeded = async (
  options: StartAuditAlertMonitorJobOptions,
  evaluation: AuditAlertEvaluation
): Promise<AuditAlertNotificationResult> => {
  if (!options.webhookUrl) {
    return {
      attempted: false,
      sent: false,
      reason: 'webhook_not_configured',
      statusCode: null,
      error: null,
    };
  }

  if (evaluation.severity !== 'critical') {
    return {
      attempted: false,
      sent: false,
      reason: 'severity_not_critical',
      statusCode: null,
      error: null,
    };
  }

  const nowMs = Date.now();
  const cooldownMs = options.cooldownMinutes * 60 * 1000;
  const cooldownActive =
    monitorStatus.lastNotificationAt &&
    monitorStatus.lastNotificationSeverity === 'critical' &&
    nowMs - monitorStatus.lastNotificationAt.getTime() < cooldownMs;

  if (cooldownActive) {
    return {
      attempted: false,
      sent: false,
      reason: 'cooldown_active',
      statusCode: null,
      error: null,
    };
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), options.webhookTimeoutMs);

  try {
    const response = await fetch(options.webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        event: 'audit.alert.critical',
        timestamp: evaluation.generatedAt.toISOString(),
        severity: evaluation.severity,
        reason: evaluation.reason,
        window: {
          fromDate: evaluation.window.fromDate.toISOString(),
          toDate: evaluation.window.toDate.toISOString(),
          minutes: evaluation.window.minutes,
        },
        thresholds: evaluation.thresholds,
        metrics: evaluation.metrics,
        topFailingActions: evaluation.topFailingActions,
      }),
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      return {
        attempted: true,
        sent: false,
        reason: 'webhook_non_success_status',
        statusCode: response.status,
        error: `Webhook returned status ${response.status}`,
      };
    }

    return {
      attempted: true,
      sent: true,
      reason: null,
      statusCode: response.status,
      error: null,
    };
  } catch (error) {
    return {
      attempted: true,
      sent: false,
      reason: 'webhook_request_failed',
      statusCode: null,
      error: error instanceof Error ? error.message : 'Unknown webhook request error',
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const getAuditAlertMonitorStatus = (): AuditAlertMonitorStatus => {
  return {
    ...monitorStatus,
    startedAt: monitorStatus.startedAt ? new Date(monitorStatus.startedAt) : null,
    lastRunAt: monitorStatus.lastRunAt ? new Date(monitorStatus.lastRunAt) : null,
    lastSuccessAt: monitorStatus.lastSuccessAt ? new Date(monitorStatus.lastSuccessAt) : null,
    nextRunAt: monitorStatus.nextRunAt ? new Date(monitorStatus.nextRunAt) : null,
    lastNotificationAt: monitorStatus.lastNotificationAt
      ? new Date(monitorStatus.lastNotificationAt)
      : null,
  };
};

export const runAuditAlertMonitorNow = async (): Promise<AuditAlertMonitorRunResult | null> => {
  if (!monitorStatus.enabled || !manualRunHandler) {
    return null;
  }

  return manualRunHandler();
};

export const startAuditAlertMonitorJob = (
  options: StartAuditAlertMonitorJobOptions
): (() => void) => {
  monitorStatus.enabled = options.enabled;
  monitorStatus.webhookConfigured = Boolean(options.webhookUrl);
  monitorStatus.checkIntervalMinutes = options.checkIntervalMinutes;
  monitorStatus.cooldownMinutes = options.cooldownMinutes;
  monitorStatus.webhookTimeoutMs = options.webhookTimeoutMs;
  monitorStatus.windowMinutes = options.windowMinutes;
  monitorStatus.minEvents = options.minEvents;
  monitorStatus.warningFailureRate = options.warningFailureRate;
  monitorStatus.criticalFailureRate = options.criticalFailureRate;
  monitorStatus.startedAt = new Date();
  monitorStatus.lastError = null;
  monitorStatus.lastSkipReason = null;

  if (!options.enabled) {
    monitorStatus.nextRunAt = null;
    monitorStatus.isRunning = false;
    monitorStatus.lastRunMode = null;
    manualRunHandler = null;

    logger.info('audit.alert.monitor.disabled', {
      reason: 'disabled_by_environment',
    });

    return () => {};
  }

  const intervalMs = options.checkIntervalMinutes * 60 * 1000;
  let isRunning = false;

  const runMonitor = async (
    mode: 'scheduled' | 'manual'
  ): Promise<AuditAlertMonitorRunResult> => {
    const startedAt = new Date();

    if (isRunning) {
      const finishedAt = new Date();
      const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
      monitorStatus.lastSkipReason = 'already_running';

      return {
        ran: false,
        skipped: true,
        mode,
        reason: 'already_running',
        startedAt,
        finishedAt,
        durationMs,
        evaluation: null,
        notification: null,
      };
    }

    isRunning = true;
    monitorStatus.isRunning = true;
    monitorStatus.lastRunAt = startedAt;
    monitorStatus.lastRunMode = mode;
    monitorStatus.lastSkipReason = null;
    monitorStatus.lastError = null;
    const runStartedAtMs = startedAt.getTime();
    let finishedAt = new Date();
    let durationMs = 0;

    try {
      const now = new Date();
      const evaluation = await evaluateCurrentAlert(options, now);
      const notification = await notifyWebhookIfNeeded(options, evaluation);

      monitorStatus.lastSeverity = evaluation.severity;
      monitorStatus.lastReason = evaluation.reason;
      monitorStatus.lastFailureRate = evaluation.metrics.failureRate;
      monitorStatus.lastTotalCount = evaluation.metrics.totalCount;
      monitorStatus.lastNotificationReason = notification.reason;
      monitorStatus.lastNotificationStatusCode = notification.statusCode;
      monitorStatus.lastNotificationError = notification.error;

      if (notification.sent) {
        monitorStatus.lastNotificationAt = now;
        monitorStatus.lastNotificationSeverity = evaluation.severity;
      }

      if (notification.attempted && !notification.sent) {
        logger.warn('audit.alert.monitor.notify_failed', {
          reason: notification.reason,
          statusCode: notification.statusCode,
          error: notification.error,
          severity: evaluation.severity,
          failureRate: evaluation.metrics.failureRate,
          totalCount: evaluation.metrics.totalCount,
        });
      }

      if (notification.sent) {
        logger.warn('audit.alert.monitor.notified', {
          severity: evaluation.severity,
          failureRate: evaluation.metrics.failureRate,
          totalCount: evaluation.metrics.totalCount,
          webhookStatusCode: notification.statusCode,
        });
      }

      monitorStatus.lastSuccessAt = new Date();
      finishedAt = new Date();
      durationMs = finishedAt.getTime() - runStartedAtMs;

      return {
        ran: true,
        skipped: false,
        mode,
        reason: null,
        startedAt,
        finishedAt,
        durationMs,
        evaluation,
        notification,
      };
    } catch (error) {
      finishedAt = new Date();
      durationMs = finishedAt.getTime() - runStartedAtMs;
      monitorStatus.lastError =
        error instanceof Error ? error.message : 'Unknown audit alert monitor error';

      logger.error('audit.alert.monitor.failed', {
        error: logger.serializeError(error),
      });

      return {
        ran: false,
        skipped: false,
        mode,
        reason: 'run_failed',
        startedAt,
        finishedAt,
        durationMs,
        evaluation: null,
        notification: null,
      };
    } finally {
      isRunning = false;
      monitorStatus.isRunning = false;
      monitorStatus.nextRunAt = new Date(Date.now() + intervalMs);
    }
  };

  monitorStatus.nextRunAt = new Date(Date.now() + intervalMs);
  manualRunHandler = () => runMonitor('manual');
  void runMonitor('scheduled');

  const timer = setInterval(() => {
    void runMonitor('scheduled');
  }, intervalMs);

  timer.unref();

  logger.info('audit.alert.monitor.started', {
    checkIntervalMinutes: options.checkIntervalMinutes,
    cooldownMinutes: options.cooldownMinutes,
    webhookConfigured: Boolean(options.webhookUrl),
    windowMinutes: options.windowMinutes,
    minEvents: options.minEvents,
    warningFailureRate: options.warningFailureRate,
    criticalFailureRate: options.criticalFailureRate,
  });

  return () => {
    clearInterval(timer);
    monitorStatus.enabled = false;
    monitorStatus.isRunning = false;
    monitorStatus.nextRunAt = null;
    manualRunHandler = null;

    logger.info('audit.alert.monitor.stopped', {
      checkIntervalMinutes: options.checkIntervalMinutes,
      cooldownMinutes: options.cooldownMinutes,
    });
  };
};

export type { AuditAlertMonitorStatus, AuditAlertMonitorRunResult, StartAuditAlertMonitorJobOptions };
