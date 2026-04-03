import AdminNotificationDelivery from '../models/AdminNotificationDelivery.js';
import { logger } from '../utils/logger.js';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

interface StartAdminNotificationRetentionJobOptions {
  enabled: boolean;
  retentionDays: number;
  intervalMinutes: number;
}

interface AdminNotificationRetentionStatus {
  enabled: boolean;
  retentionDays: number | null;
  intervalMinutes: number | null;
  isRunning: boolean;
  startedAt: Date | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  nextRunAt: Date | null;
  lastDeletedCount: number | null;
  lastCutoff: Date | null;
  lastDurationMs: number | null;
  lastRunMode: 'scheduled' | 'manual' | null;
  lastSkipReason: string | null;
  lastError: string | null;
}

interface AdminNotificationRetentionRunResult {
  ran: boolean;
  skipped: boolean;
  mode: 'scheduled' | 'manual';
  reason: string | null;
  deletedCount: number | null;
  cutoff: Date | null;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
}

const retentionStatus: AdminNotificationRetentionStatus = {
  enabled: false,
  retentionDays: null,
  intervalMinutes: null,
  isRunning: false,
  startedAt: null,
  lastRunAt: null,
  lastSuccessAt: null,
  nextRunAt: null,
  lastDeletedCount: null,
  lastCutoff: null,
  lastDurationMs: null,
  lastRunMode: null,
  lastSkipReason: null,
  lastError: null,
};

let manualRunHandler: (() => Promise<AdminNotificationRetentionRunResult>) | null = null;

const calculateCutoffDate = (retentionDays: number, now: Date): Date => {
  return new Date(now.getTime() - retentionDays * DAY_IN_MS);
};

export const pruneAdminNotificationDeliveries = async (
  retentionDays: number,
  now: Date = new Date()
): Promise<number> => {
  const cutoff = calculateCutoffDate(retentionDays, now);
  const result = await AdminNotificationDelivery.deleteMany({ createdAt: { $lt: cutoff } });
  const deletedCount = result.deletedCount ?? 0;

  logger.info('admin.notification.retention.pruned', {
    retentionDays,
    cutoff: cutoff.toISOString(),
    deletedCount,
  });

  return deletedCount;
};

export const getAdminNotificationRetentionStatus = (): AdminNotificationRetentionStatus => {
  return {
    ...retentionStatus,
    startedAt: retentionStatus.startedAt ? new Date(retentionStatus.startedAt) : null,
    lastRunAt: retentionStatus.lastRunAt ? new Date(retentionStatus.lastRunAt) : null,
    lastSuccessAt: retentionStatus.lastSuccessAt ? new Date(retentionStatus.lastSuccessAt) : null,
    nextRunAt: retentionStatus.nextRunAt ? new Date(retentionStatus.nextRunAt) : null,
    lastCutoff: retentionStatus.lastCutoff ? new Date(retentionStatus.lastCutoff) : null,
  };
};

export const runAdminNotificationRetentionNow = async (): Promise<AdminNotificationRetentionRunResult | null> => {
  if (!retentionStatus.enabled || !manualRunHandler) {
    return null;
  }

  return manualRunHandler();
};

export const startAdminNotificationRetentionJob = ({
  enabled,
  retentionDays,
  intervalMinutes,
}: StartAdminNotificationRetentionJobOptions): (() => void) => {
  retentionStatus.enabled = enabled;
  retentionStatus.retentionDays = retentionDays;
  retentionStatus.intervalMinutes = intervalMinutes;
  retentionStatus.startedAt = new Date();
  retentionStatus.lastError = null;
  retentionStatus.lastSkipReason = null;

  if (!enabled) {
    retentionStatus.nextRunAt = null;
    retentionStatus.isRunning = false;
    retentionStatus.lastRunMode = null;
    manualRunHandler = null;

    logger.info('admin.notification.retention.disabled', {
      reason: 'disabled_by_environment',
    });

    return () => {};
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  let isRunning = false;

  const runPrune = async (mode: 'scheduled' | 'manual'): Promise<AdminNotificationRetentionRunResult> => {
    const startedAt = new Date();

    if (isRunning) {
      const finishedAt = new Date();
      const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
      retentionStatus.lastSkipReason = 'already_running';

      return {
        ran: false,
        skipped: true,
        mode,
        reason: 'already_running',
        deletedCount: null,
        cutoff: null,
        startedAt,
        finishedAt,
        durationMs,
      };
    }

    isRunning = true;
    retentionStatus.isRunning = true;
    retentionStatus.lastRunAt = startedAt;
    retentionStatus.lastRunMode = mode;
    retentionStatus.lastSkipReason = null;
    retentionStatus.lastError = null;
    const runStartedAtMs = startedAt.getTime();
    let finishedAt = new Date();
    let durationMs = 0;
    let cutoff: Date | null = null;

    try {
      const now = new Date();
      cutoff = calculateCutoffDate(retentionDays, now);
      const deletedCount = await pruneAdminNotificationDeliveries(retentionDays, now);

      retentionStatus.lastDeletedCount = deletedCount;
      retentionStatus.lastCutoff = cutoff;
      retentionStatus.lastSuccessAt = new Date();
      finishedAt = new Date();
      durationMs = finishedAt.getTime() - runStartedAtMs;
      retentionStatus.lastDurationMs = durationMs;
      retentionStatus.lastError = null;

      return {
        ran: true,
        skipped: false,
        mode,
        reason: null,
        deletedCount,
        cutoff,
        startedAt,
        finishedAt,
        durationMs,
      };
    } catch (error) {
      finishedAt = new Date();
      durationMs = finishedAt.getTime() - runStartedAtMs;
      retentionStatus.lastDurationMs = durationMs;
      retentionStatus.lastError =
        error instanceof Error ? error.message : 'Unknown admin notification retention error';

      logger.error('admin.notification.retention.failed', {
        retentionDays,
        error: logger.serializeError(error),
      });

      return {
        ran: false,
        skipped: false,
        mode,
        reason: 'run_failed',
        deletedCount: null,
        cutoff,
        startedAt,
        finishedAt,
        durationMs,
      };
    } finally {
      isRunning = false;
      retentionStatus.isRunning = false;
      retentionStatus.nextRunAt = new Date(Date.now() + intervalMs);
    }
  };

  retentionStatus.nextRunAt = new Date(Date.now() + intervalMs);
  manualRunHandler = () => runPrune('manual');
  void runPrune('scheduled');

  const timer = setInterval(() => {
    void runPrune('scheduled');
  }, intervalMs);

  timer.unref();

  logger.info('admin.notification.retention.started', {
    retentionDays,
    intervalMinutes,
  });

  return () => {
    clearInterval(timer);
    retentionStatus.enabled = false;
    retentionStatus.isRunning = false;
    retentionStatus.nextRunAt = null;
    manualRunHandler = null;

    logger.info('admin.notification.retention.stopped', {
      retentionDays,
      intervalMinutes,
    });
  };
};

export type {
  AdminNotificationRetentionRunResult,
  AdminNotificationRetentionStatus,
  StartAdminNotificationRetentionJobOptions,
};
