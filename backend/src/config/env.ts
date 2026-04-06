import dotenv from 'dotenv';

dotenv.config();

type NodeEnv = 'development' | 'test' | 'production';
type TrustProxyValue = boolean | number | undefined;

interface EnvironmentConfig {
  nodeEnv: NodeEnv;
  isProduction: boolean;
  uploadDriver: 'local' | 'cloudinary';
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  mongoUri: string;
  jwtSecret: string;
  frontendUrl: string;
  corsOrigins: string[];
  trustProxy: TrustProxyValue;
  redisUrl: string | null;
  razorpayKeyId: string | null;
  razorpayKeySecret: string | null;
  razorpayWebhookSecret: string | null;
  auditLogRetentionDays: number;
  auditLogPruneIntervalMinutes: number;
  auditAlertWindowMinutes: number;
  auditAlertMinEvents: number;
  auditAlertWarningFailureRate: number;
  auditAlertCriticalFailureRate: number;
  auditAlertNotifierEnabled: boolean;
  auditAlertWebhookUrl: string | null;
  auditAlertCheckIntervalMinutes: number;
  auditAlertNotificationCooldownMinutes: number;
  auditAlertWebhookTimeoutMs: number;
  cloudinary: {
    cloudName: string | null;
    apiKey: string | null;
    apiSecret: string | null;
    folder: string;
  };
  adminNotifications: {
    orderEnabled: boolean;
    paymentEnabled: boolean;
    supportEnabled: boolean;
    feedbackEnabled: boolean;
  };
  adminNotificationRetry: {
    enabled: boolean;
    intervalMinutes: number;
    maxAttempts: number;
    baseDelayMinutes: number;
    batchSize: number;
  };
  adminNotificationRetention: {
    enabled: boolean;
    retentionDays: number;
    intervalMinutes: number;
  };
}

const trimValue = (value: string | undefined): string => {
  return value?.trim() ?? '';
};

const hasRepeatedCharacters = (value: string): boolean => {
  return /(.)\1{5,}/.test(value);
};

const hasLongSequentialCharacters = (value: string): boolean => {
  const lower = value.toLowerCase();
  const sequences = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm'];

  return sequences.some((sequence) => {
    for (let index = 0; index <= sequence.length - 6; index += 1) {
      const fragment = sequence.slice(index, index + 6);

      if (lower.includes(fragment)) {
        return true;
      }
    }

    return false;
  });
};

const ensureHttpUrl = (value: string, key: string, errors: string[]): string => {
  try {
    const parsed = new URL(value);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      errors.push(`${key} must use http:// or https://`);
      return value;
    }

    return parsed.toString().replace(/\/$/, '');
  } catch {
    errors.push(`${key} must be a valid URL`);
    return value;
  }
};

const parsePort = (raw: string, errors: string[]): number => {
  if (!raw) {
    return 5000;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    errors.push('PORT must be an integer between 1 and 65535');
    return 5000;
  }

  return parsed;
};

const parseLogLevel = (
  raw: string,
  errors: string[]
): 'debug' | 'info' | 'warn' | 'error' => {
  if (!raw) {
    return 'info';
  }

  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }

  errors.push('LOG_LEVEL must be one of: debug, info, warn, error');
  return 'info';
};

const parseBoundedInteger = (
  raw: string,
  fallback: number,
  min: number,
  max: number,
  key: string,
  errors: string[]
): number => {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    errors.push(`${key} must be an integer between ${min} and ${max}`);
    return fallback;
  }

  return parsed;
};

const parseBoundedNumber = (
  raw: string,
  fallback: number,
  min: number,
  max: number,
  key: string,
  errors: string[]
): number => {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);

  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    errors.push(`${key} must be a number between ${min} and ${max}`);
    return fallback;
  }

  return parsed;
};

const parseTrustProxy = (raw: string, errors: string[]): TrustProxyValue => {
  if (!raw) {
    return undefined;
  }

  if (raw === 'true') {
    return true;
  }

  if (raw === 'false') {
    return false;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 0) {
    errors.push('TRUST_PROXY must be "true", "false", or a non-negative integer');
    return undefined;
  }

  return parsed;
};

const parseBoolean = (raw: string, fallback: boolean, key: string, errors: string[]): boolean => {
  if (!raw) {
    return fallback;
  }

  if (raw === 'true') {
    return true;
  }

  if (raw === 'false') {
    return false;
  }

  errors.push(`${key} must be "true" or "false"`);
  return fallback;
};

const parseNodeEnv = (raw: string, errors: string[]): NodeEnv => {
  if (!raw) {
    return 'development';
  }

  if (raw === 'development' || raw === 'test' || raw === 'production') {
    return raw;
  }

  errors.push('NODE_ENV must be one of: development, test, production');
  return 'development';
};

const parseUploadDriver = (
  raw: string,
  errors: string[]
): 'local' | 'cloudinary' => {
  if (!raw || raw === 'local') {
    return 'local';
  }

  if (raw === 'cloudinary') {
    return 'cloudinary';
  }

  errors.push('UPLOAD_DRIVER must be either "local" or "cloudinary"');
  return 'local';
};

const parseCorsOrigins = (raw: string, fallback: string, errors: string[]): string[] => {
  const source = raw || fallback;
  const values = source
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (values.length === 0) {
    errors.push('CORS_ORIGIN must include at least one allowed origin');
    return [];
  }

  return values.map((origin) => ensureHttpUrl(origin, `CORS_ORIGIN (${origin})`, errors));
};

const parseRedisUrl = (raw: string, errors: string[]): string | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);

    if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
      errors.push('REDIS_URL must use redis:// or rediss://');
      return null;
    }

    return parsed.toString();
  } catch {
    errors.push('REDIS_URL must be a valid URL');
    return null;
  }
};

const parseMongoUri = (raw: string, errors: string[]): string => {
  if (!raw) {
    errors.push('MONGO_URI is required');
    return raw;
  }

  if (!(raw.startsWith('mongodb://') || raw.startsWith('mongodb+srv://'))) {
    errors.push('MONGO_URI must start with mongodb:// or mongodb+srv://');
  }

  return raw;
};

const parseOptionalHttpUrl = (raw: string, key: string, errors: string[]): string | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      errors.push(`${key} must use http:// or https://`);
      return null;
    }

    return parsed.toString();
  } catch {
    errors.push(`${key} must be a valid URL`);
    return null;
  }
};

const parseJwtSecret = (raw: string, nodeEnv: NodeEnv, errors: string[]): string => {
  if (!raw) {
    errors.push('JWT_SECRET is required');
    return raw;
  }

  if (raw.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters');
  }

  const normalized = raw.toLowerCase();
  const weakIndicators = ['changeme', 'change-me', 'change_in_production', 'secret', 'password', 'test', 'admin'];
  const weakWordCount = weakIndicators.filter((indicator) => normalized.includes(indicator)).length;
  const appearsWeakByWords = weakWordCount >= 2;
  const appearsPatterned = hasRepeatedCharacters(raw) || hasLongSequentialCharacters(raw);

  if (appearsWeakByWords || appearsPatterned) {
    const message =
      'JWT_SECRET appears weak or patterned. Use a long, random secret generated from a cryptographic source.';

    if (nodeEnv === 'production') {
      errors.push(message);
    } else {
      console.warn(`Environment warning: ${message}`);
    }
  }

  return raw;
};

const buildEnvironmentConfig = (): EnvironmentConfig => {
  const errors: string[] = [];

  const nodeEnv = parseNodeEnv(trimValue(process.env.NODE_ENV), errors);
  const uploadDriver = parseUploadDriver(trimValue(process.env.UPLOAD_DRIVER), errors);
  const port = parsePort(trimValue(process.env.PORT), errors);
  const logLevel = parseLogLevel(trimValue(process.env.LOG_LEVEL), errors);

  const mongoUri = parseMongoUri(trimValue(process.env.MONGO_URI), errors);
  const jwtSecret = parseJwtSecret(trimValue(process.env.JWT_SECRET), nodeEnv, errors);

  const frontendUrl = ensureHttpUrl(
    trimValue(process.env.FRONTEND_URL) || 'http://localhost:3000',
    'FRONTEND_URL',
    errors
  );
  const corsOrigins = parseCorsOrigins(trimValue(process.env.CORS_ORIGIN), frontendUrl, errors);
  const trustProxy = parseTrustProxy(trimValue(process.env.TRUST_PROXY), errors);
  const redisUrl = parseRedisUrl(trimValue(process.env.REDIS_URL), errors);

  const razorpayKeyId = trimValue(process.env.RAZORPAY_KEY_ID) || null;
  const razorpayKeySecret = trimValue(process.env.RAZORPAY_KEY_SECRET) || null;
  const razorpayWebhookSecret = trimValue(process.env.RAZORPAY_WEBHOOK_SECRET) || null;
  const auditLogRetentionDays = parseBoundedInteger(
    trimValue(process.env.AUDIT_LOG_RETENTION_DAYS),
    180,
    1,
    3650,
    'AUDIT_LOG_RETENTION_DAYS',
    errors
  );
  const auditLogPruneIntervalMinutes = parseBoundedInteger(
    trimValue(process.env.AUDIT_LOG_PRUNE_INTERVAL_MINUTES),
    60,
    5,
    1440,
    'AUDIT_LOG_PRUNE_INTERVAL_MINUTES',
    errors
  );
  const auditAlertWindowMinutes = parseBoundedInteger(
    trimValue(process.env.AUDIT_ALERT_WINDOW_MINUTES),
    15,
    1,
    1440,
    'AUDIT_ALERT_WINDOW_MINUTES',
    errors
  );
  const auditAlertMinEvents = parseBoundedInteger(
    trimValue(process.env.AUDIT_ALERT_MIN_EVENTS),
    20,
    1,
    100000,
    'AUDIT_ALERT_MIN_EVENTS',
    errors
  );
  const auditAlertWarningFailureRate = parseBoundedNumber(
    trimValue(process.env.AUDIT_ALERT_WARNING_FAILURE_RATE),
    5,
    0,
    100,
    'AUDIT_ALERT_WARNING_FAILURE_RATE',
    errors
  );
  const auditAlertCriticalFailureRate = parseBoundedNumber(
    trimValue(process.env.AUDIT_ALERT_CRITICAL_FAILURE_RATE),
    15,
    0,
    100,
    'AUDIT_ALERT_CRITICAL_FAILURE_RATE',
    errors
  );
  const auditAlertNotifierEnabled = parseBoolean(
    trimValue(process.env.AUDIT_ALERT_NOTIFIER_ENABLED),
    true,
    'AUDIT_ALERT_NOTIFIER_ENABLED',
    errors
  );
  const auditAlertWebhookUrl = parseOptionalHttpUrl(
    trimValue(process.env.AUDIT_ALERT_WEBHOOK_URL),
    'AUDIT_ALERT_WEBHOOK_URL',
    errors
  );
  const auditAlertCheckIntervalMinutes = parseBoundedInteger(
    trimValue(process.env.AUDIT_ALERT_CHECK_INTERVAL_MINUTES),
    5,
    1,
    1440,
    'AUDIT_ALERT_CHECK_INTERVAL_MINUTES',
    errors
  );
  const auditAlertNotificationCooldownMinutes = parseBoundedInteger(
    trimValue(process.env.AUDIT_ALERT_NOTIFICATION_COOLDOWN_MINUTES),
    30,
    1,
    10080,
    'AUDIT_ALERT_NOTIFICATION_COOLDOWN_MINUTES',
    errors
  );
  const auditAlertWebhookTimeoutMs = parseBoundedInteger(
    trimValue(process.env.AUDIT_ALERT_WEBHOOK_TIMEOUT_MS),
    5000,
    500,
    30000,
    'AUDIT_ALERT_WEBHOOK_TIMEOUT_MS',
    errors
  );
  const adminNotificationOrderEnabled = parseBoolean(
    trimValue(process.env.ADMIN_NOTIFICATION_ORDER_ENABLED),
    true,
    'ADMIN_NOTIFICATION_ORDER_ENABLED',
    errors
  );
  const adminNotificationPaymentEnabled = parseBoolean(
    trimValue(process.env.ADMIN_NOTIFICATION_PAYMENT_ENABLED),
    true,
    'ADMIN_NOTIFICATION_PAYMENT_ENABLED',
    errors
  );
  const adminNotificationSupportEnabled = parseBoolean(
    trimValue(process.env.ADMIN_NOTIFICATION_SUPPORT_ENABLED),
    true,
    'ADMIN_NOTIFICATION_SUPPORT_ENABLED',
    errors
  );
  const adminNotificationFeedbackEnabled = parseBoolean(
    trimValue(process.env.ADMIN_NOTIFICATION_FEEDBACK_ENABLED),
    true,
    'ADMIN_NOTIFICATION_FEEDBACK_ENABLED',
    errors
  );
  const adminNotificationRetryEnabled = parseBoolean(
    trimValue(process.env.ADMIN_NOTIFICATION_RETRY_ENABLED),
    true,
    'ADMIN_NOTIFICATION_RETRY_ENABLED',
    errors
  );
  const adminNotificationRetryIntervalMinutes = parseBoundedInteger(
    trimValue(process.env.ADMIN_NOTIFICATION_RETRY_INTERVAL_MINUTES),
    5,
    1,
    1440,
    'ADMIN_NOTIFICATION_RETRY_INTERVAL_MINUTES',
    errors
  );
  const adminNotificationRetryMaxAttempts = parseBoundedInteger(
    trimValue(process.env.ADMIN_NOTIFICATION_RETRY_MAX_ATTEMPTS),
    5,
    1,
    20,
    'ADMIN_NOTIFICATION_RETRY_MAX_ATTEMPTS',
    errors
  );
  const adminNotificationRetryBaseDelayMinutes = parseBoundedInteger(
    trimValue(process.env.ADMIN_NOTIFICATION_RETRY_BASE_DELAY_MINUTES),
    10,
    1,
    1440,
    'ADMIN_NOTIFICATION_RETRY_BASE_DELAY_MINUTES',
    errors
  );
  const adminNotificationRetryBatchSize = parseBoundedInteger(
    trimValue(process.env.ADMIN_NOTIFICATION_RETRY_BATCH_SIZE),
    20,
    1,
    200,
    'ADMIN_NOTIFICATION_RETRY_BATCH_SIZE',
    errors
  );
  const adminNotificationRetentionEnabled = parseBoolean(
    trimValue(process.env.ADMIN_NOTIFICATION_RETENTION_ENABLED),
    true,
    'ADMIN_NOTIFICATION_RETENTION_ENABLED',
    errors
  );
  const adminNotificationRetentionDays = parseBoundedInteger(
    trimValue(process.env.ADMIN_NOTIFICATION_RETENTION_DAYS),
    180,
    1,
    3650,
    'ADMIN_NOTIFICATION_RETENTION_DAYS',
    errors
  );
  const adminNotificationRetentionIntervalMinutes = parseBoundedInteger(
    trimValue(process.env.ADMIN_NOTIFICATION_RETENTION_INTERVAL_MINUTES),
    60,
    5,
    1440,
    'ADMIN_NOTIFICATION_RETENTION_INTERVAL_MINUTES',
    errors
  );

  if (auditAlertCriticalFailureRate < auditAlertWarningFailureRate) {
    errors.push(
      'AUDIT_ALERT_CRITICAL_FAILURE_RATE must be greater than or equal to AUDIT_ALERT_WARNING_FAILURE_RATE'
    );
  }

  if ((razorpayKeyId && !razorpayKeySecret) || (!razorpayKeyId && razorpayKeySecret)) {
    errors.push('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set together');
  }

  if (
    nodeEnv === 'production' &&
    razorpayKeyId &&
    razorpayKeySecret &&
    !razorpayWebhookSecret
  ) {
    errors.push('RAZORPAY_WEBHOOK_SECRET is required in production when Razorpay is enabled');
  }

  const cloudinaryCloudName = trimValue(process.env.CLOUDINARY_CLOUD_NAME) || null;
  const cloudinaryApiKey = trimValue(process.env.CLOUDINARY_API_KEY) || null;
  const cloudinaryApiSecret = trimValue(process.env.CLOUDINARY_API_SECRET) || null;
  const cloudinaryFolder = trimValue(process.env.CLOUDINARY_FOLDER) || 'gaumaya-uploads';

  if (uploadDriver === 'cloudinary') {
    if (!cloudinaryCloudName) {
      errors.push('CLOUDINARY_CLOUD_NAME is required when UPLOAD_DRIVER=cloudinary');
    }

    if (!cloudinaryApiKey || !cloudinaryApiSecret) {
      errors.push('CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are required when UPLOAD_DRIVER=cloudinary');
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}`
    );
  }

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    uploadDriver,
    port,
    logLevel,
    mongoUri,
    jwtSecret,
    frontendUrl,
    corsOrigins,
    trustProxy,
    redisUrl,
    razorpayKeyId,
    razorpayKeySecret,
    razorpayWebhookSecret,
    auditLogRetentionDays,
    auditLogPruneIntervalMinutes,
    auditAlertWindowMinutes,
    auditAlertMinEvents,
    auditAlertWarningFailureRate,
    auditAlertCriticalFailureRate,
    auditAlertNotifierEnabled,
    auditAlertWebhookUrl,
    auditAlertCheckIntervalMinutes,
    auditAlertNotificationCooldownMinutes,
    auditAlertWebhookTimeoutMs,
    cloudinary: {
      cloudName: cloudinaryCloudName,
      apiKey: cloudinaryApiKey,
      apiSecret: cloudinaryApiSecret,
      folder: cloudinaryFolder,
    },
    adminNotifications: {
      orderEnabled: adminNotificationOrderEnabled,
      paymentEnabled: adminNotificationPaymentEnabled,
      supportEnabled: adminNotificationSupportEnabled,
      feedbackEnabled: adminNotificationFeedbackEnabled,
    },
    adminNotificationRetry: {
      enabled: adminNotificationRetryEnabled,
      intervalMinutes: adminNotificationRetryIntervalMinutes,
      maxAttempts: adminNotificationRetryMaxAttempts,
      baseDelayMinutes: adminNotificationRetryBaseDelayMinutes,
      batchSize: adminNotificationRetryBatchSize,
    },
    adminNotificationRetention: {
      enabled: adminNotificationRetentionEnabled,
      retentionDays: adminNotificationRetentionDays,
      intervalMinutes: adminNotificationRetentionIntervalMinutes,
    },
  };
};

const env = buildEnvironmentConfig();

export default env;
