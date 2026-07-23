/**
 * whatsappOnboarding.ts — transactional emails for the manual ("concierge")
 * WhatsApp connection pipeline.
 *
 * Two audiences:
 *   • the Zero team (platform admins) — nudged when a clinic needs action
 *   • the clinic — told when to enter their code, and when they're live
 *
 * All copy is plain text (see ./index.ts for why). sendEmail never throws, so
 * these are safe to fire without awaiting.
 */

import { sendEmail } from './index';
import { env } from '../../config/env';
import { getPlatformAdminEmails } from '../../middleware/auth';
import { logger } from '../../config/logger';

interface ClinicLike {
  id: string;
  name: string;
  whatsappRequestedNumber?: string | null;
  whatsappSetupChoice?: string | null;
  whatsappNotifyEmail?: string | null;
  whatsappOtpCode?: string | null;
}

const adminDashboardUrl = `${env.FRONTEND_URL}/admin`;

// ── To the Zero team ──────────────────────────────────────────────────────

function notifyAdmins(subject: string, text: string): void {
  const admins = getPlatformAdminEmails();
  if (admins.length === 0) {
    logger.warn('No PLATFORM_ADMIN_EMAILS set — skipping admin WhatsApp notification', { subject });
    return;
  }
  for (const to of admins) {
    sendEmail({ to, subject, text });
  }
}

export function notifyAdminsNewRequest(clinic: ClinicLike): void {
  const choice = clinic.whatsappSetupChoice === 'migrate' ? 'Migrate existing number' : 'New number';
  notifyAdmins(
    `[Zero] WhatsApp request — ${clinic.name}`,
    `${clinic.name} requested a WhatsApp connection.\n\n` +
      `Number: ${clinic.whatsappRequestedNumber || '(not provided)'}\n` +
      `Setup: ${choice}\n` +
      `Contact email: ${clinic.whatsappNotifyEmail || '(none)'}\n\n` +
      `Add the number to our Meta Business Manager, then hit "Send code" in the admin dashboard:\n${adminDashboardUrl}\n\n— Zero`
  );
}

export function notifyAdminsClinicReady(clinic: ClinicLike): void {
  notifyAdmins(
    `[Zero] Clinic is ready for its code — ${clinic.name}`,
    `${clinic.name} is online and ready to receive their WhatsApp code.\n\n` +
      `This is a good moment to run the verification so the code doesn't expire.\n${adminDashboardUrl}\n\n— Zero`
  );
}

export function notifyAdminsOtpSubmitted(clinic: ClinicLike): void {
  notifyAdmins(
    `[Zero] Code submitted — ${clinic.name}`,
    `${clinic.name} just entered their verification code:\n\n` +
      `    ${clinic.whatsappOtpCode || '(empty)'}\n\n` +
      `Enter it in Meta Business Manager NOW — codes expire in ~10 minutes.\n${adminDashboardUrl}\n\n— Zero`
  );
}

// ── To the clinic ─────────────────────────────────────────────────────────

export function notifyClinicEnterOtp(clinic: ClinicLike): void {
  const to = clinic.whatsappNotifyEmail;
  if (!to) return;
  sendEmail({
    to,
    subject: 'Your WhatsApp code is on the way — enter it now',
    text:
      `Hi ${clinic.name},\n\n` +
      `We've started connecting your WhatsApp number. Meta is sending a 6-digit ` +
      `verification code to ${clinic.whatsappRequestedNumber || 'your number'} by SMS or call.\n\n` +
      `Please open Zero and enter it right away — codes expire in about 10 minutes:\n` +
      `${env.FRONTEND_URL}\n\n` +
      `Didn't get a code? You can ask us to resend it from the same screen.\n\n— Zero`,
  });
}

export function notifyClinicConnected(clinic: ClinicLike): void {
  const to = clinic.whatsappNotifyEmail;
  if (!to) return;
  sendEmail({
    to,
    subject: 'Your WhatsApp is connected 🎉',
    text:
      `Hi ${clinic.name},\n\n` +
      `Great news — your WhatsApp number is now connected to Zero. Your patients ` +
      `can book, get reminders, and reach your clinic 24/7 right from WhatsApp.\n\n` +
      `Open your dashboard to see it live:\n${env.FRONTEND_URL}\n\n— Zero`,
  });
}
