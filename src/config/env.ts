import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  GEMINI_API_KEY: z.string().min(1),
  META_ACCESS_TOKEN: z.string().min(1),
  META_VERIFY_TOKEN: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  FROM_EMAIL: z.string().email().default('zero@latencyzero.com'),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_PUBLIC_KEY: z.string().optional(),
  FRONTEND_URL: z.string().url().default('https://zero-kappa-mocha.vercel.app'),
  // Comma-separated extra origins allowed for CORS (e.g. local dev servers)
  FRONTEND_URLS_EXTRA: z.string().optional(),
  JOB_SECRET: z.string().min(16),
});

const result = schema.safeParse(process.env);
if (!result.success) {
  console.error('❌ Missing/invalid env vars:', result.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = result.data;
