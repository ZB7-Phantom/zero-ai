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
  accessToken?: string // clinic-specific token if available
): Promise<void> {
  // Clean recipient phone: strip '+' and non-digits, convert local 0x to 234x
  let cleanTo = to.replace(/\D/g, '');
  if (cleanTo.startsWith('0') && cleanTo.length === 11) {
    cleanTo = '234' + cleanTo.slice(1);
  }

  // Use clinic token if provided, fall back to global token
  const token = (accessToken && accessToken.trim().length > 0) ? accessToken.trim() : env.META_ACCESS_TOKEN;

  logger.info(`Sending WhatsApp message to ${cleanTo} via phoneId ${phoneNumberId}`, {
    tokenPrefix: token ? `${token.slice(0, 12)}...` : 'MISSING',
    usingClinicToken: !!(accessToken && accessToken.trim().length > 0),
    messageLength: text.length,
  });

  try {
    const res = await axios.post(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanTo,
        type: 'text',
        text: { preview_url: false, body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    logger.info('WhatsApp message delivered to Meta API successfully', {
      to: cleanTo,
      messageId: res.data?.messages?.[0]?.id,
    });
  } catch (err: any) {
    const errorData = err.response?.data?.error || err.response?.data || err.message;
    const metaErrorStr = typeof errorData === 'object' ? JSON.stringify(errorData) : errorData;
    
    logger.error(`WhatsApp send failed: ${metaErrorStr}`, {
      to: cleanTo,
      phoneNumberId,
      status: err.response?.status,
    });
    
// Bubble up so handlers.ts can flag the conversation for review
    throw err;
  }
}

// Sends an interactive button menu via WhatsApp Cloud API
export async function sendWhatsAppInteractiveMenu(
  phoneNumberId: string,
  to: string,
  text: string,
  accessToken?: string
): Promise<void> {
  let cleanTo = to.replace(/\D/g, '');
  if (cleanTo.startsWith('0') && cleanTo.length === 11) {
    cleanTo = '234' + cleanTo.slice(1);
  }

  const token = (accessToken && accessToken.trim().length > 0) ? accessToken.trim() : env.META_ACCESS_TOKEN;

  logger.info(`Sending WhatsApp interactive menu to ${cleanTo} via phoneId ${phoneNumberId}`);

  try {
    const res = await axios.post(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanTo,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'walkin', title: 'Walk-in' } },
              { type: 'reply', reply: { id: 'appointment', title: 'Book appointment' } },
              { type: 'reply', reply: { id: 'enquiries', title: 'Enquiries' } }
            ]
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    logger.info('WhatsApp interactive menu delivered successfully', {
      to: cleanTo,
      messageId: res.data?.messages?.[0]?.id,
    });
  } catch (err: any) {
    const errorData = err.response?.data?.error || err.response?.data || err.message;
    logger.error(`WhatsApp interactive menu failed: ${typeof errorData === 'object' ? JSON.stringify(errorData) : errorData}`);
    throw err;
  }
}

export async function markReadAndShowTyping(
  phoneNumberId: string, 
  messageId: string,
  accessToken?: string
) {
  const token = (accessToken && accessToken.trim().length > 0) ? accessToken.trim() : env.META_ACCESS_TOKEN;

  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' },
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
  } catch (err: any) {
    const errorData = err.response?.data?.error || err.response?.data || err.message;
    logger.warn('Failed to mark read', { error: typeof errorData === 'object' ? JSON.stringify(errorData) : errorData });
  }
}
