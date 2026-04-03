import AdminNotificationDelivery from '../models/AdminNotificationDelivery.js';
import { sendEmail } from '../utils/email.js';
import { logger } from '../utils/logger.js';
import { calculateNextNotificationRetryAt } from './adminNotificationService.js';

interface StartAdminNotificationRetryJobOptions {
  enabled: boolean;
  intervalMinutes: number;
  batchSize: number;
  baseDelayMinutes: number;
}

interface AdminNotificationRetryStatus {
  enabled: boolean;
  isRunning: boolean;
  startedAt: Date | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  nextRunAt: Date | null;
  intervalMinutes: number | null;
  batchSize: number | null;
  baseDelayMinutes: number | null;
  lastRunMode: 'scheduled' | 'manual' | null;
  lastError: string | null;
  lastSkipReason: string | null;
  lastProcessedCount: number;
  lastSentCount: number;
  lastFailedCount: number;
}

interface AdminNotificationRetryRunResult {
  ran: boolean;
  skipped: boolean;
  mode: 'scheduled' | 'manual';
  reason: string | null;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  processedCount: number;
  sentCount: number;
  failedCount: number;
}

const retryStatus: AdminNotificationRetryStatus = {
  enabled: false,
  isRunning: false,
  startedAt: null,
  lastRunAt: null,
  lastSuccessAt: null,
  nextRunAt: null,
  intervalMinutes: null,
  batchSize: null,
  baseDelayMinutes: null,
  lastRunMode: null,
  lastError: null,
  lastSkipReason: null,
  lastProcessedCount: 0,
  lastSentCount: 0,
  lastFailedCount: 0,
};

let manualRunHandler: (() => Promise<AdminNotificationRetryRunResult>) | null = null;

export const getAdminNotificationRetryStatus = (): AdminNotificationRetryStatus => {
  return {
    ...retryStatus,
    startedAt: retryStatus.startedAt ? new Date(retryStatus.startedAt) : null,
    lastRunAt: retryStatus.lastRunAt ? new Date(retryStatus.lastRunAt) : null,
    lastSuccessAt: retryStatus.lastSuccessAt ? new Date(retryStatus.lastSuccessAt) : null,
    nextRunAt: retryStatus.nextRunAt ? new Date(retryStatus.nextRunAt) : null,
  };
};

export const runAdminNotificationRetryNow = async (): Promise<AdminNotificationRetryRunResult | null> => {
  if (!retryStatus.enabled || !manualRunHandler) {
    return null;
  }

  return manualRunHandler();
};

export const startAdminNotificationRetryJob = (
  options: StartAdminNotificationRetryJobOptions
): (() => void) => {
  retryStatus.enabled = options.enabled;
  retryStatus.intervalMinutes = options.intervalMinutes;
  retryStatus.batchSize = options.batchSize;
  retryStatus.baseDelayMinutes = options.baseDelayMinutes;
  retryStatus.startedAt = new Date();
  retryStatus.lastError = null;
  retryStatus.lastSkipReason = null;

  if (!options.enabled) {
    retryStatus.nextRunAt = null;
    retryStatus.isRunning = false;
    retryStatus.lastRunMode = null;
    manualRunHandler = null;

    logger.info('admin.notification.retry.disabled', {
      reason: 'disabled_by_environment',
    });

    return () => {};
  }

  const intervalMs = options.intervalMinutes * 60 * 1000;
  let isRunning = false;

  const runRetry = async (
    mode: 'scheduled' | 'manual'
  ): Promise<AdminNotificationRetryRunResult> => {
    const startedAt = new Date();

    if (isRunning) {
      const finishedAt = new Date();
      const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
      retryStatus.lastSkipReason = 'already_running';

      return {
        ran: false,
        skipped: true,
        mode,
        reason: 'already_running',
        startedAt,
        finishedAt,
        durationMs,
        processedCount: 0,
        sentCount: 0,
        failedCount: 0,
      };
    }

    isRunning = true;
    retryStatus.isRunning = true;
    retryStatus.lastRunAt = startedAt;
    retryStatus.lastRunMode = mode;
    retryStatus.lastSkipReason = null;
    retryStatus.lastError = null;

    const runStartedAtMs = startedAt.getTime();
    let finishedAt = new Date();
    let durationMs = 0;
    let processedCount = 0;
    let sentCount = 0;
    let failedCount = 0;

    try {
      for (let index = 0; index < options.batchSize; index += 1) {
        const now = new Date();

        const claimed = await AdminNotificationDelivery.findOneAndUpdate(
          {
            status: 'failed',
            nextRetryAt: { $ne: null, $lte: now },
            $expr: { $lt: ['$attempts', '$maxAttempts'] },
          },
          {
            $set: {
              status: 'retrying',
            },
          },
          {
            sort: { nextRetryAt: 1, createdAt: 1 },
            new: true,
          }
        );

        if (!claimed) {
          break;
        }

        processedCount += 1;
        const attemptAt = new Date();
        const attempts = claimed.attempts + 1;
        const maxAttempts = Math.max(1, claimed.maxAttempts);
        let nextStatus: 'sent' | 'failed' = 'failed';
        let nextFailureReason: string | null = null;
        let nextRetryAt: Date | null = null;
        let nextSentAt: Date | null = null;

        if (claimed.recipients.length === 0) {
          nextFailureReason = 'No recipients configured for this notification.';
        } else {
          try {
            const sent = await sendEmail({
              to: claimed.recipients.join(', '),
              subject: claimed.subject,
              text: claimed.text,
              html: claimed.html,
            });

            if (sent) {
              nextStatus = 'sent';
              nextFailureReason = null;
              nextRetryAt = null;
              nextSentAt = attemptAt;
              sentCount += 1;
            } else {
              nextFailureReason = 'Email provider is unavailable or SMTP is not configured.';
            }
          } catch (error) {
            nextFailureReason = error instanceof Error ? error.message : 'Unknown email delivery error';
          }
        }

        if (nextStatus === 'failed') {
          failedCount += 1;
          nextRetryAt = calculateNextNotificationRetryAt({
            attempts,
            maxAttempts,
            baseDelayMinutes: options.baseDelayMinutes,
            fromDate: attemptAt,
          });
        }

        await AdminNotificationDelivery.findByIdAndUpdate(claimed._id, {
          $set: {
            status: nextStatus,
            failureReason: nextFailureReason,
            attempts,
            nextRetryAt,
            lastAttemptAt: attemptAt,
            sentAt: nextSentAt,
          },
        });
      }

      retryStatus.lastProcessedCount = processedCount;
      retryStatus.lastSentCount = sentCount;
      retryStatus.lastFailedCount = failedCount;
      retryStatus.lastSuccessAt = new Date();
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
        processedCount,
        sentCount,
        failedCount,
      };
    } catch (error) {
      finishedAt = new Date();
      durationMs = finishedAt.getTime() - runStartedAtMs;
      retryStatus.lastError = error instanceof Error ? error.message : 'Unknown notification retry error';

      logger.error('admin.notification.retry.failed', {
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
        processedCount,
        sentCount,
        failedCount,
      };
    } finally {
      isRunning = false;
      retryStatus.isRunning = false;
      retryStatus.nextRunAt = new Date(Date.now() + intervalMs);
    }
  };

  retryStatus.nextRunAt = new Date(Date.now() + intervalMs);
  manualRunHandler = () => runRetry('manual');
  void runRetry('scheduled');

  const timer = setInterval(() => {
    void runRetry('scheduled');
  }, intervalMs);

  timer.unref();

  logger.info('admin.notification.retry.started', {
    intervalMinutes: options.intervalMinutes,
    batchSize: options.batchSize,
    baseDelayMinutes: options.baseDelayMinutes,
  });

  return () => {
    clearInterval(timer);
    retryStatus.enabled = false;
    retryStatus.isRunning = false;
    retryStatus.nextRunAt = null;
    manualRunHandler = null;

    logger.info('admin.notification.retry.stopped', {
      intervalMinutes: options.intervalMinutes,
      batchSize: options.batchSize,
    });
  };
};

export type {
  AdminNotificationRetryRunResult,
  AdminNotificationRetryStatus,
  StartAdminNotificationRetryJobOptions,
};
