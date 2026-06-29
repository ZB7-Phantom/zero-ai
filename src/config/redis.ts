import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // Required by Bull — do not change
  enableReadyCheck: false,    // Required by Bull — do not change
  retryStrategy: (times) => Math.min(times * 1000, 30000), // Exponential backoff, capped at 30s
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error('Redis error', { error: err.message }));
