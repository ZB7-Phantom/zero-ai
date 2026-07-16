import Redis from 'ioredis';
import { env } from './env';

// Bull requires three separate Redis clients per queue instance.
// We pass the Upstash URL directly — ioredis parses TLS from the
// rediss:// scheme automatically. Do NOT add a separate tls: {}
// option when using a URL string — it creates a double-TLS
// conflict that silently kills the connection before it opens.
export function createBullClient(type: string): Redis {
  const url = env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is not set — cannot create Bull client');
  }
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
