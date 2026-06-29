import { z } from 'zod';

export const UpdateClinicSchema = z.object({
  name: z.string().min(2).optional(),
  address: z.string().optional(),
  services: z.array(z.string()).optional(),
  openDays: z.array(z.number().min(0).max(6)).optional(),
  opensAt: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  closesAt: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});
