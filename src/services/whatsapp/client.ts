import axios from 'axios';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

// Sends a text message to a WhatsApp number via Meta Cloud API.
// phoneNumberId — the clinic's Meta phone number ID
// to — the patient's WhatsApp number (e.g. "2349130242222")
// text — the message to send
export async function sendWhatsAppMessage(
  phoneNumberId: string,
  to: string,
  text: string,
  accessToken?: string  // clinic-specific token if available
): Promise<void> {
  // Use clinic token if provided, fall back to global token
  const token = accessToken || env.META_ACCESS_TOKEN;

  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (err: any) {
    // Log but never throw — a failed send should not crash the webhook handler
    logger.error('WhatsApp send failed', {
      to,
      phoneNumberId,
      error: err.response?.data || err.message,
    });
  }
}
