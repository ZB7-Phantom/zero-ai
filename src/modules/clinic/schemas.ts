import { z } from 'zod';

const DAY_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export const UpdateClinicSchema = z.object({
  // Accept frontend naming (servicesOffered) or our internal naming (services)
  name: z.string().min(2).optional(),
  address: z.string().optional(),
  servicesOffered: z.array(z.string()).optional(),
  services: z.array(z.string()).optional(),
  operatingHours: z.object({
    days: z.array(z.string()).optional(),
    openTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    closeTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  }).optional(),
  openDays: z.array(z.number()).optional(),
  opensAt: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  closesAt: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

// Normalises frontend field names to internal DB field names
export function normaliseClinicUpdate(raw: z.infer<typeof UpdateClinicSchema>) {
  return {
    name: raw.name,
    address: raw.address,
    services: raw.servicesOffered ?? raw.services,
    openDays: raw.operatingHours?.days
      ? raw.operatingHours.days.map((d) => DAY_MAP[d] ?? 0)
      : raw.openDays,
    opensAt: raw.operatingHours?.openTime ?? raw.opensAt,
    closesAt: raw.operatingHours?.closeTime ?? raw.closesAt,
  };
}
