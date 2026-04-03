import env from '../config/env.js';
import AdminNotificationDelivery, {
  type AdminNotificationDeliveryStatus,
  type AdminNotificationEventType,
  type AdminNotificationSkipReason,
} from '../models/AdminNotificationDelivery.js';
import { sendEmail } from '../utils/email.js';
import { logger } from '../utils/logger.js';

export interface AdminNotificationMessage {
  eventType: AdminNotificationEventType;
  subject: string;
  text: string;
  html: string;
}

let hasLoggedMissingRecipientsWarning = false;
const hasLoggedDisabledEventWarnings = new Set<AdminNotificationEventType>();
const MAX_RETRY_DELAY_MINUTES = 24 * 60;

const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const parseAdminRecipients = (): string[] => {
  const recipients = new Set<string>();
  const sources = [
    process.env.ADMIN_NOTIFICATION_EMAILS ?? '',
    process.env.ADMIN_ALERT_EMAILS ?? '',
    process.env.BOOTSTRAP_ADMIN_EMAIL ?? '',
  ];

  for (const source of sources) {
    const entries = source
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0);

    for (const email of entries) {
      if (isValidEmail(email)) {
        recipients.add(email);
      }
    }
  }

  return Array.from(recipients);
};

const getAdminRecipients = (): string[] => parseAdminRecipients();

const isNotificationEventEnabled = (eventType: AdminNotificationEventType): boolean => {
  switch (eventType) {
    case 'order':
      return env.adminNotifications.orderEnabled;
    case 'payment':
      return env.adminNotifications.paymentEnabled;
    case 'support':
      return env.adminNotifications.supportEnabled;
    case 'feedback':
      return env.adminNotifications.feedbackEnabled;
    default:
      return true;
  }
};

export const calculateNextNotificationRetryAt = (input: {
  attempts: number;
  maxAttempts: number;
  baseDelayMinutes: number;
  fromDate?: Date;
}): Date | null => {
  if (input.attempts >= input.maxAttempts) {
    return null;
  }

  const fromDate = input.fromDate ?? new Date();
  const delayMinutes = Math.min(
    MAX_RETRY_DELAY_MINUTES,
    input.baseDelayMinutes * Math.pow(2, Math.max(0, input.attempts - 1))
  );

  return new Date(fromDate.getTime() + delayMinutes * 60 * 1000);
};

const safeLogNotificationDelivery = async (input: {
  message: AdminNotificationMessage;
  recipients: string[];
  status: AdminNotificationDeliveryStatus;
  skipReason?: AdminNotificationSkipReason;
  failureReason?: string | null;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: Date | null;
  lastAttemptAt?: Date | null;
  sentAt?: Date | null;
}): Promise<void> => {
  try {
    await AdminNotificationDelivery.create({
      eventType: input.message.eventType,
      subject: input.message.subject,
      text: input.message.text,
      html: input.message.html,
      recipients: input.recipients,
      status: input.status,
      skipReason: input.skipReason ?? null,
      failureReason: input.failureReason ?? null,
      attempts: input.attempts,
      maxAttempts: input.maxAttempts,
      nextRetryAt: input.nextRetryAt ?? null,
      lastAttemptAt: input.lastAttemptAt ?? null,
      sentAt: input.sentAt ?? null,
    });
  } catch (error) {
    logger.error('admin.notification.delivery.log_failed', {
      eventType: input.message.eventType,
      status: input.status,
      error: logger.serializeError(error),
    });
  }
};

export const getAdminConsoleOrdersUrl = (): string => `${env.frontendUrl}/admin/orders`;
export const getAdminConsolePaymentsUrl = (): string => `${env.frontendUrl}/admin/payments`;
export const getAdminConsoleSupportUrl = (): string => `${env.frontendUrl}/admin/support`;
export const getAdminConsoleFeedbackUrl = (): string => `${env.frontendUrl}/admin/feedback`;

export const safeSendAdminNotificationEmail = async (
  message: AdminNotificationMessage
): Promise<boolean> => {
  const recipients = getAdminRecipients();
  const maxAttempts = env.adminNotificationRetry.maxAttempts;

  if (!isNotificationEventEnabled(message.eventType)) {
    if (!hasLoggedDisabledEventWarnings.has(message.eventType)) {
      hasLoggedDisabledEventWarnings.add(message.eventType);
      console.info(`Admin ${message.eventType} email notifications are disabled by environment toggle.`);
    }
    await safeLogNotificationDelivery({
      message,
      recipients,
      status: 'skipped',
      skipReason: 'event_disabled',
      attempts: 0,
      maxAttempts,
    });

    return false;
  }

  if (recipients.length === 0) {
    if (!hasLoggedMissingRecipientsWarning) {
      hasLoggedMissingRecipientsWarning = true;
      console.warn(
        'Admin notification emails are disabled because ADMIN_NOTIFICATION_EMAILS (or ADMIN_ALERT_EMAILS/BOOTSTRAP_ADMIN_EMAIL) is not configured.'
      );
    }
    await safeLogNotificationDelivery({
      message,
      recipients,
      status: 'skipped',
      skipReason: 'no_recipients',
      attempts: 0,
      maxAttempts,
    });

    return false;
  }

  const attemptedAt = new Date();

  try {
    const sent = await sendEmail({
      to: recipients.join(', '),
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    if (sent) {
      await safeLogNotificationDelivery({
        message,
        recipients,
        status: 'sent',
        attempts: 1,
        maxAttempts,
        sentAt: attemptedAt,
        lastAttemptAt: attemptedAt,
      });
      return true;
    }

    await safeLogNotificationDelivery({
      message,
      recipients,
      status: 'failed',
      failureReason: 'Email provider is unavailable or SMTP is not configured.',
      attempts: 1,
      maxAttempts,
      nextRetryAt: calculateNextNotificationRetryAt({
        attempts: 1,
        maxAttempts,
        baseDelayMinutes: env.adminNotificationRetry.baseDelayMinutes,
        fromDate: attemptedAt,
      }),
      lastAttemptAt: attemptedAt,
    });

    return false;
  } catch (error) {
    console.error('Failed to send admin notification email:', error);
    const failureReason = error instanceof Error ? error.message : 'Unknown email delivery error';
    await safeLogNotificationDelivery({
      message,
      recipients,
      status: 'failed',
      failureReason,
      attempts: 1,
      maxAttempts,
      nextRetryAt: calculateNextNotificationRetryAt({
        attempts: 1,
        maxAttempts,
        baseDelayMinutes: env.adminNotificationRetry.baseDelayMinutes,
        fromDate: attemptedAt,
      }),
      lastAttemptAt: attemptedAt,
    });
    return false;
  }
};
