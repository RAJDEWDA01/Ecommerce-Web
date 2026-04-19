import connectDB from './config/db.js';
import env from './config/env.js';
import app from './app.js';
import { startAuditAlertMonitorJob } from './services/auditAlertMonitor.js';
import { startAdminNotificationRetryJob } from './services/adminNotificationRetry.js';
import { startAdminNotificationRetentionJob } from './services/adminNotificationRetention.js';
import { startAuditRetentionJob } from './services/auditRetention.js';

const bootstrap = async (): Promise<void> => {
  await connectDB();
  const stopAuditRetentionJob = startAuditRetentionJob({
    enabled: env.nodeEnv !== 'test',
    retentionDays: env.auditLogRetentionDays,
    intervalMinutes: env.auditLogPruneIntervalMinutes,
  });
  const stopAuditAlertMonitorJob = startAuditAlertMonitorJob({
    enabled: env.nodeEnv !== 'test' && env.auditAlertNotifierEnabled,
    webhookUrl: env.auditAlertWebhookUrl,
    checkIntervalMinutes: env.auditAlertCheckIntervalMinutes,
    cooldownMinutes: env.auditAlertNotificationCooldownMinutes,
    webhookTimeoutMs: env.auditAlertWebhookTimeoutMs,
    windowMinutes: env.auditAlertWindowMinutes,
    minEvents: env.auditAlertMinEvents,
    warningFailureRate: env.auditAlertWarningFailureRate,
    criticalFailureRate: env.auditAlertCriticalFailureRate,
  });
  const stopAdminNotificationRetryJob = startAdminNotificationRetryJob({
    enabled: env.nodeEnv !== 'test' && env.adminNotificationRetry.enabled,
    intervalMinutes: env.adminNotificationRetry.intervalMinutes,
    batchSize: env.adminNotificationRetry.batchSize,
    baseDelayMinutes: env.adminNotificationRetry.baseDelayMinutes,
  });
  const stopAdminNotificationRetentionJob = startAdminNotificationRetentionJob({
    enabled: env.nodeEnv !== 'test' && env.adminNotificationRetention.enabled,
    retentionDays: env.adminNotificationRetention.retentionDays,
    intervalMinutes: env.adminNotificationRetention.intervalMinutes,
  });

  const host = '0.0.0.0';
  const server = app.listen(env.port, host, () => {
    console.log(`Server is running on http://${host}:${env.port}`);
  });

  const shutdown = (): void => {
    stopAuditRetentionJob();
    stopAuditAlertMonitorJob();
    stopAdminNotificationRetryJob();
    stopAdminNotificationRetentionJob();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

bootstrap().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
