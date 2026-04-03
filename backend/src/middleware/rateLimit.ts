import type { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../config/redis.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfigDefaults {
  windowMinutes: number;
  maxRequests: number;
}

interface CreateRateLimiterOptions {
  identifier: string;
  windowMs: number;
  maxRequests: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const defaultMessage = 'Too many requests. Please try again after some time.';

const defaultKeyGenerator = (req: Request): string => {
  return req.ip || req.socket.remoteAddress || 'unknown';
};

const parsePositiveInteger = (rawValue: string | undefined): number | null => {
  if (!rawValue) {
    return null;
  }

  const parsed = Number(rawValue.trim());

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const cleanupExpiredEntries = (now: number): void => {
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
};

interface LimitDecision {
  limited: boolean;
  retryAfterSeconds: number;
}

const decideLimitForInMemory = (
  key: string,
  now: number,
  windowMs: number,
  maxRequests: number
): LimitDecision => {
  if (rateLimitStore.size > 5000) {
    cleanupExpiredEntries(now);
  }

  const existing = rateLimitStore.get(key);

  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });

    return {
      limited: false,
      retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
    };
  }

  if (existing.count >= maxRequests) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  rateLimitStore.set(key, existing);

  return {
    limited: false,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
};

const decideLimitForRedis = async (
  key: string,
  now: number,
  windowMs: number,
  maxRequests: number
): Promise<LimitDecision | null> => {
  const redis = await getRedisClient();

  if (!redis) {
    return null;
  }

  try {
    const windowId = Math.floor(now / windowMs);
    const windowKey = `rl:${windowId}:${key}`;
    const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));

    const count = await redis.incr(windowKey);
    await redis.expire(windowKey, windowSeconds, 'NX');

    const ttl = await redis.ttl(windowKey);
    const retryAfterSeconds = ttl > 0 ? ttl : windowSeconds;

    return {
      limited: count > maxRequests,
      retryAfterSeconds,
    };
  } catch (error) {
    console.error('Redis rate limiter failed, using in-memory fallback:', error);
    return null;
  }
};

export const readRateLimitFromEnv = (
  envPrefix: string,
  defaults: RateLimitConfigDefaults
): { windowMs: number; maxRequests: number } => {
  const maxFromEnv = parsePositiveInteger(process.env[`${envPrefix}_MAX`]);
  const windowMinutesFromEnv = parsePositiveInteger(process.env[`${envPrefix}_WINDOW_MINUTES`]);

  const maxRequests = maxFromEnv ?? defaults.maxRequests;
  const windowMinutes = windowMinutesFromEnv ?? defaults.windowMinutes;

  return {
    maxRequests,
    windowMs: windowMinutes * 60 * 1000,
  };
};

export const createRateLimiter = ({
  identifier,
  windowMs,
  maxRequests,
  message = defaultMessage,
  keyGenerator = defaultKeyGenerator,
}: CreateRateLimiterOptions) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const now = Date.now();
    const requestKey = `${identifier}:${keyGenerator(req)}`;

    const redisDecision = await decideLimitForRedis(requestKey, now, windowMs, maxRequests);
    const decision =
      redisDecision ?? decideLimitForInMemory(requestKey, now, windowMs, maxRequests);

    if (decision.limited) {
      const retryAfterSeconds = decision.retryAfterSeconds;

      res.setHeader('Retry-After', retryAfterSeconds.toString());
      res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        message,
        retryAfterSeconds,
      });
      return;
    }

    next();
  };
};
