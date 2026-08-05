import { PrismaClient } from '@prisma/client';
import { env } from './env';

const g = globalThis as { prisma?: PrismaClient };

function getDatabaseUrl(): string {
  let url = env.DATABASE_URL;
  if (!url.includes('pgbouncer=true')) {
    url += url.includes('?') ? '&pgbouncer=true' : '?pgbouncer=true';
  }
  return url;
}

export const prisma = g.prisma ?? new PrismaClient({
  datasources: {
    db: {
      url: getDatabaseUrl(),
    },
  },
  log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (env.NODE_ENV !== 'production') g.prisma = prisma;
