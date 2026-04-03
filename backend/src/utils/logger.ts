import env from '../config/env.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogData {
  [key: string]: unknown;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const parseLogLevel = (rawLevel: string | undefined): LogLevel => {
  if (!rawLevel) {
    return 'info';
  }

  const normalized = rawLevel.trim().toLowerCase();

  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error') {
    return normalized;
  }

  return 'info';
};

const configuredLogLevel = parseLogLevel(env.logLevel);

const shouldLog = (level: LogLevel): boolean => {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[configuredLogLevel];
};

const serializeError = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
};

const emitLog = (level: LogLevel, event: string, data: LogData = {}): void => {
  if (!shouldLog(level)) {
    return;
  }

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...data,
  };

  const line = JSON.stringify(payload);

  if (level === 'error') {
    console.error(line);
    return;
  }

  console.log(line);
};

export const logger = {
  debug: (event: string, data: LogData = {}) => emitLog('debug', event, data),
  info: (event: string, data: LogData = {}) => emitLog('info', event, data),
  warn: (event: string, data: LogData = {}) => emitLog('warn', event, data),
  error: (event: string, data: LogData = {}) => emitLog('error', event, data),
  serializeError,
};

export type { LogData, LogLevel };
