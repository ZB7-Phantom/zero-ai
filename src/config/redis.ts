import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

export let redis: Redis | null = null;

if (env.REDIS_URL) {
  redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => Math.min(times * 1000, 30000),
  });
  redis?.on('connect', () => logger.info('Redis connected'));
  redis?.on('error', (err) => logger.error('Redis error', { error: err.message }));
} else {
  logger.warn('REDIS_URL not set — Redis disabled, conversation locking inactive');
}
