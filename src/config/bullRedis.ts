import Redis from 'ioredis';
import { env } from './env';

// Bull requires three separate Redis clients: regular, subscriber,
// and bclient. We create them from the same URL so TLS and auth
// are always correctly inherited — never spread from redis.options
// which loses URL-parsed credentials.
export function createBullClient(type: 'client' | 'subscriber' | 'bclient') {
  console.log(`createBullClient called — type: ${type}, url prefix: ${process.env.REDIS_URL?.slice(0,20)}`);
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    tls: env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
  });
}
