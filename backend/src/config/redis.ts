import { createClient, type RedisClientType } from 'redis';
import env from './env.js';

let redisClient: RedisClientType | null = null;
let connectInFlight: Promise<RedisClientType | null> | null = null;
let hasLoggedConnectionError = false;

const getRedisUrl = (): string | null => {
  return env.redisUrl;
};

const connectRedis = async (): Promise<RedisClientType | null> => {
  const redisUrl = getRedisUrl();

  if (!redisUrl) {
    return null;
  }

  if (redisClient?.isOpen) {
    return redisClient;
  }

  if (connectInFlight) {
    return connectInFlight;
  }

  connectInFlight = (async () => {
    try {
      if (!redisClient) {
        redisClient = createClient({ url: redisUrl });

        redisClient.on('error', (error) => {
          if (!hasLoggedConnectionError) {
            console.error('Redis client error. Falling back to in-memory rate limiter:', error);
            hasLoggedConnectionError = true;
          }
        });
      }

      if (!redisClient.isOpen) {
        await redisClient.connect();
      }

      hasLoggedConnectionError = false;
      return redisClient;
    } catch (error) {
      if (!hasLoggedConnectionError) {
        console.error('Failed to connect to Redis. Falling back to in-memory rate limiter:', error);
        hasLoggedConnectionError = true;
      }

      return null;
    } finally {
      connectInFlight = null;
    }
  })();

  return connectInFlight;
};

export const getRedisClient = async (): Promise<RedisClientType | null> => {
  return connectRedis();
};
