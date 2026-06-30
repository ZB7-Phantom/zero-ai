import Bull from 'bull';
import { redis } from '../../config/redis';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { sendWhatsAppMessage } from '../whatsapp/client';

export const reminderQueue = new Bull('appointment-reminders', { redis: { ...redis.options } });

reminderQueue.process('send-24h-reminders', async () => {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000); // 23h from now
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);   // 25h from now

  const dueAppointments = await prisma.appointment.findMany({
    where: {
      scheduledAt: { gte: windowStart, lte: windowEnd },
      status: { in: ['PENDING', 'CONFIRMED'] },
      reminder24hSentAt: null,
    },
    include: { clinic: true },
  });

  logger.info('Reminder job running', { count: dueAppointments.length });

  for (const appt of dueAppointments) {
    if (!appt.clinic.phoneNumberId || !appt.patientPhone) continue;

    const time = appt.scheduledAt.toLocaleString('en-US', {
      weekday: 'long',
      hour: 'numeric',
      minute: '2-digit',
    });

    const message = `Hi ${appt.patientName || ''}, this is a reminder from ${appt.clinic.name} — you have an appointment ${time}${appt.doctorName ? ` with ${appt.doctorName}` : ''}. Reply CANCEL if you can no longer make it.`;

    await sendWhatsAppMessage(appt.clinic.phoneNumberId, appt.patientPhone, message);

    await prisma.appointment.update({
      where: { id: appt.id },
      data: { reminder24hSentAt: new Date() },
    });
  }
});

export async function scheduleReminders() {
  const existing = await reminderQueue.getRepeatableJobs();
  for (const job of existing) {
    await reminderQueue.removeRepeatableByKey(job.key);
  }

  // Every hour, on the hour
  await reminderQueue.add('send-24h-reminders', {}, { repeat: { cron: '0 * * * *' } });

  logger.info('Reminder job scheduled');
}
