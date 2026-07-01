import { z } from 'zod';

export const AddStaffSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  role: z.enum(['ADMIN', 'PHYSICIAN', 'STAFF']),
  whatsappNumber: z.string().optional(),
  specialization: z.string().optional(),
  // Accept roleOrSpecialization from frontend onboarding wizard
  roleOrSpecialization: z.string().optional(),
});

export const UpdateStaffSchema = AddStaffSchema.partial();
