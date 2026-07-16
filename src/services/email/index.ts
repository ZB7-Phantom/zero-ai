/**
 * email/index.ts — Brevo transactional email (HTTP API).
 *
 * All transactional emails go through this file.
 * Plain text only — no HTML templates needed at this stage.
 * Keep emails short, clear, and actionable.
 *
 * Uses Brevo's REST API over HTTPS rather than SMTP — Railway blocks
 * outbound SMTP entirely (confirmed: both port 465 and 587 time out),
 * so any SMTP-based provider (Gmail, etc.) cannot work from this host.
 */

import axios from 'axios';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  if (!env.BREVO_API_KEY || !env.FROM_EMAIL) {
    logger.warn('Email not configured — skipping');
    return;
  }

  try {
    await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { email: env.FROM_EMAIL, name: env.FROM_NAME },
        to: [{ email: options.to }],
        subject: options.subject,
        textContent: options.text,
      },
      {
        headers: {
          'api-key': env.BREVO_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 10_000,
      }
    );
    logger.info('Email sent', { to: options.to, subject: options.subject });
  } catch (err) {
    // Log but never throw — email failure should not crash
    // the operation that triggered it
    const message = axios.isAxiosError(err)
      ? JSON.stringify(err.response?.data ?? err.message)
      : (err as Error).message;
    logger.error('Email send failed', { to: options.to, error: message });
  }
}
