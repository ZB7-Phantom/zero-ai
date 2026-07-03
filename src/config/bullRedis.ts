import Redis from 'ioredis';
import { env } from './env';

// Bull requires three separate Redis clients per queue instance.
// We pass the Upstash URL directly — ioredis parses TLS from the
// rediss:// scheme automatically. Do NOT add a separate tls: {}
// option when using a URL string — it creates a double-TLS
// conflict that silently kills the connection before it opens.
export function createBullClient(
  type: 'client' | 'subscriber' | 'bclient'
): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // No tls option here — rediss:// URL handles it automatically
  });
}
