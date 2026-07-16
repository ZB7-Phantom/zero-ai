/**
 * scheduler/index.ts — In-process cron jobs using node-cron.
 *
 * Replaces Bull entirely. No Redis dependency.
 * Jobs run in the same process as the server — simple,
 * reliable, zero infrastructure cost.
 *
 * Three jobs:
 *  - Midnight reset: recalculates recall status, resets queue
 *  - Appointment reminders: 24h before each appointment
 *  - No-show detection: every 30 minutes
 */

import cron from 'node-cron';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { sendWhatsAppMessage } from '../whatsapp/client';

// ── MIDNIGHT RESET ─────────────────────────────────────────────
// Runs at 00:00 every day.
// Updates recall status for all patients.
async function runMidnightReset() {
  logger.info('Running midnight reset');
  try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    await Promise.all([
      prisma.patient.updateMany({
        where: {
          lastVisitAt: { lt: ninetyDaysAgo },
          nextAppointmentAt: null,
          recallStatus: { not: 'OVERDUE' },
        },
        data: { recallStatus: 'OVERDUE' },
      }),
      prisma.patient.updateMany({
        where: {
          lastVisitAt: { gte: ninetyDaysAgo, lt: sixtyDaysAgo },
          nextAppointmentAt: null,
          recallStatus: { not: 'DUE_SOON' },
        },
        data: { recallStatus: 'DUE_SOON' },
      }),
    ]);

    logger.info('Midnight reset complete');
  } catch (err) {
    logger.error('Midnight reset failed', { error: (err as Error).message });
  }
}

// ── APPOINTMENT REMINDERS ──────────────────────────────────────
// Runs every hour.
// Finds appointments in the 23-25 hour window and sends reminders.
async function runAppointmentReminders() {
  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const appointments = await prisma.appointment.findMany({
      where: {
        scheduledAt: { gte: windowStart, lte: windowEnd },
        status: { in: ['PENDING', 'CONFIRMED'] },
        reminder24hSentAt: null,
      },
      include: { clinic: true },
    });

    if (!appointments.length) return;
    logger.info('Sending appointment reminders', { count: appointments.length });

    const sentIds: string[] = [];

    for (const appt of appointments) {
      if (!appt.clinic.phoneNumberId || !appt.patientPhone) continue;

      const time = appt.scheduledAt.toLocaleString('en-US', {
        weekday: 'long', hour: 'numeric', minute: '2-digit',
      });

      const token = appt.clinic.metaAccessToken || undefined;
      await sendWhatsAppMessage(
        appt.clinic.phoneNumberId,
        appt.patientPhone,
        `Hi ${appt.patientName || 'there'}, reminder from *${appt.clinic.name}* — you have an appointment ${time}${appt.doctorName ? ` with ${appt.doctorName}` : ''}. Reply CANCEL if you can no longer make it.`,
        token
      );
      sentIds.push(appt.id);
    }

    if (sentIds.length) {
      await prisma.appointment.updateMany({
        where: { id: { in: sentIds } },
        data: { reminder24hSentAt: new Date() },
      });
    }
  } catch (err) {
    logger.error('Appointment reminders failed', { error: (err as Error).message });
  }
}

// ── NO-SHOW DETECTION ──────────────────────────────────────────
// Runs every 30 minutes.
// Marks appointments as NO_SHOW if they passed 15 min ago.
async function runNoShowDetection() {
  try {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);

    const noShows = await prisma.appointment.findMany({
      where: {
        scheduledAt: { lte: cutoff },
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
      include: { clinic: true },
    });

    if (!noShows.length) return;
    logger.info('No-show detection', { count: noShows.length });

    for (const appt of noShows) {
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { status: 'NO_SHOW' },
      });

      if (appt.patientId) {
        await prisma.patient.update({
          where: { id: appt.patientId },
          data: { status: 'NO_SHOW' },
        });
      }
    }
  } catch (err) {
    logger.error('No-show detection failed', { error: (err as Error).message });
  }
}

// ── SCHEDULER INIT ─────────────────────────────────────────────
// Called once at server startup.
export function startSchedulers() {
  // Midnight reset — 00:00 every day
  cron.schedule('0 0 * * *', runMidnightReset);

  // Appointment reminders — every hour on the hour
  cron.schedule('0 * * * *', runAppointmentReminders);

  // No-show detection — every 30 minutes
  cron.schedule('*/30 * * * *', runNoShowDetection);

  logger.info('Schedulers ready');
}
