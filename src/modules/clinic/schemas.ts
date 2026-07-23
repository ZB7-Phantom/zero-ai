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
  // Notification preferences — toggled from Settings.
  escalationAlerts: z.boolean().optional(),
  recallReminders: z.boolean().optional(),
  noShowAlerts: z.boolean().optional(),
  dailySummaryEmail: z.boolean().optional(),
});

// ── Manual WhatsApp connection (concierge flow) ────────────────────────────

// Clinic submits the number they want us to connect, plus a contact email and
// which onboarding branch they picked. Phone kept loose (E.164-ish) since
// clinics enter numbers in many formats; we normalise/clean on our side.
export const RequestWhatsAppSchema = z.object({
  phoneNumber: z.string().trim().min(6, 'Enter a valid WhatsApp number').max(20),
  email: z.string().email('Enter a valid email'),
  setupChoice: z.enum(['new', 'migrate']),
});

// Clinic relays the 6-digit code Meta sent them. Allow 4–8 digits to be safe.
export const SubmitOtpSchema = z.object({
  code: z.string().trim().regex(/^\d{4,8}$/, 'Enter the numeric code Meta sent you'),
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
    escalationAlerts: raw.escalationAlerts,
    recallReminders: raw.recallReminders,
    noShowAlerts: raw.noShowAlerts,
    dailySummaryEmail: raw.dailySummaryEmail,
  };
}
