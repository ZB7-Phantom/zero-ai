import { z } from 'zod';

// Zero team confirms the number is live on our WABA. phoneNumberId is what Meta
// gives us for the number; it's how inbound webhooks get routed to this clinic.
export const MarkConnectedSchema = z.object({
  phoneNumberId: z.string().trim().min(3, 'Enter the Meta phone number ID'),
  phoneNumber: z.string().trim().min(6).max(20).optional(),
});

// Manual plan override from the admin console (comp a clinic, extend a trial,
// upgrade/downgrade). planExpiresAt accepts a date string ("2026-08-01") or
// null to clear it; omit it to leave the expiry unchanged.
export const ChangePlanSchema = z.object({
  plan: z.enum(['STARTER', 'NAVIGATOR', 'ENTERPRISE']),
  planExpiresAt: z.union([z.string(), z.null()]).optional(),
});
