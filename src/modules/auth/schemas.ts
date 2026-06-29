import { z } from 'zod';

export const RegisterSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  clinicName: z.string().min(2),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
