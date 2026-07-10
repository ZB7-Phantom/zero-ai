/**
 * email/index.ts — Gmail SMTP email service (via Nodemailer).
 *
 * All transactional emails go through this file.
 * Plain text only — no HTML templates needed at this stage.
 * Keep emails short, clear, and actionable.
 */

import nodemailer from 'nodemailer';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

const transporter = nodemailer.createTransport({
  // Explicit host/port instead of the `service: 'gmail'` shorthand, which
  // defaults to port 465 (implicit TLS) — Railway's network times out on
  // that port. 587 (STARTTLS) is far less commonly blocked by cloud hosts.
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  requireTLS: true,
  auth: {
    user: env.GMAIL_USER,
    pass: env.GMAIL_APP_PASSWORD,
  },
  // Fail fast instead of hanging if outbound SMTP is slow/blocked by the
  // host — sendEmail() is called without awaiting it in request handlers,
  // but a stuck connection would still leak sockets indefinitely.
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 15_000,
  // Railway's network resolves smtp.gmail.com to an IPv6 address but can't
  // actually route it (ENETUNREACH) — force IPv4, which works fine.
  // `family` is a real nodemailer/net.connect option but is missing from
  // @types/nodemailer, hence the cast.
  family: 4,
} as nodemailer.TransportOptions);

interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  try {
    await transporter.sendMail({
      from: `${env.FROM_NAME} <${env.GMAIL_USER}>`,
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
