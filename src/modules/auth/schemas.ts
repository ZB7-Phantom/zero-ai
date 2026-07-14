import { z } from 'zod';

// Emails are normalized to lowercase everywhere so lookups (login, verify,
// reset) can't fail just because of casing differences from registration.
const emailField = z.string().email().trim().toLowerCase();

// Password policy for account creation / reset. Mirrors the frontend rule in
// ZERO/src/lib/password.ts (validatePassword): at least 8 chars, one letter,
// one number. Keep the two in sync so a client-accepted password is never
// then rejected by the server. Login is deliberately NOT held to this — it
// only checks the stored hash, so pre-policy accounts can still sign in.
const passwordField = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .regex(/[a-zA-Z]/, 'Password must contain at least one letter.')
  .regex(/[0-9]/, 'Password must contain at least one number.');

export const RegisterSchema = z.object({
  fullName: z.string().min(2).trim(),
  email: emailField,
  password: passwordField,
  clinicName: z.string().min(2).trim(),
});

export const LoginSchema = z.object({
  email: emailField,
  password: z.string().min(1),
});

export const ResendVerificationSchema = z.object({
  email: emailField,
});

export const ForgotPasswordSchema = z.object({
  email: emailField,
});

export const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordField,
});
