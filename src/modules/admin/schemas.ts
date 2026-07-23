import { z } from 'zod';

// Zero team confirms the number is live on our WABA. phoneNumberId is what Meta
// gives us for the number; it's how inbound webhooks get routed to this clinic.
export const MarkConnectedSchema = z.object({
  phoneNumberId: z.string().trim().min(3, 'Enter the Meta phone number ID'),
  phoneNumber: z.string().trim().min(6).max(20).optional(),
});
