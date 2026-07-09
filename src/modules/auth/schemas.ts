import { z } from 'zod';

// Emails are normalized to lowercase everywhere so lookups (login, verify,
// reset) can't fail just because of casing differences from registration.
const emailField = z.string().email().trim().toLowerCase();

export const RegisterSchema = z.object({
  fullName: z.string().min(2).trim(),
  email: emailField,
  password: z.string().min(8),
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
  password: z.string().min(8),
});
