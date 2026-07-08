/**
 * email/index.ts — Resend email service.
 *
 * All transactional emails go through this file.
 * Plain text only — no HTML templates needed at this stage.
 * Keep emails short, clear, and actionable.
 */

import { Resend } from 'resend';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

const resend = new Resend(env.RESEND_API_KEY);

interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  try {
    await resend.emails.send({
      from: env.FROM_EMAIL,
      to: options.to,
      subject: options.subject,
      text: options.text,
    });
    logger.info('Email sent', { to: options.to, subject: options.subject });
  } catch (err) {
    // Log but never throw — email failure should not crash
    // the operation that triggered it
    logger.error('Email send failed', {
      to: options.to,
      error: (err as Error).message,
    });
  }
}
