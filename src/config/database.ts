import { PrismaClient } from '@prisma/client';
import { env } from './env';

const g = globalThis as { prisma?: PrismaClient };

export const prisma = g.prisma ?? new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (env.NODE_ENV !== 'production') g.prisma = prisma;
