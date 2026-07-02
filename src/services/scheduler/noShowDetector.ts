import Bull from 'bull';
import { redis } from '../../config/redis';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { createNotification } from '../notifications/create';

import { createBullClient } from '../../config/bullRedis';

export const noShowQueue = new Bull('no-show-detector', {
  createClient: createBullClient,
});

noShowQueue.on('error', (err) => {
  logger.error('noShowQueue queue error', { error: err.message });
});

noShowQueue.on('failed', (job, err) => {
  logger.error('noShowQueue job failed', {
    jobId: job.id,
    error: err.message,
  });
});

noShowQueue.process('detect-no-shows', async () => {
  // An appointment is a no-show if it was scheduled more than
  // 15 minutes ago and the patient's status is still PENDING or CONFIRMED
  const cutoff = new Date(Date.now() - 15 * 60 * 1000);

  const noShows = await prisma.appointment.findMany({
    where: {
      scheduledAt: { lte: cutoff },
      status: { in: ['PENDING', 'CONFIRMED'] },
    },
    include: { clinic: true },
  });

  if (!noShows.length) return;

  logger.info('No-show detection running', { count: noShows.length });

  for (const appt of noShows) {
    // Mark appointment as no-show
    await prisma.appointment.update({
      where: { id: appt.id },
      data: { status: 'NO_SHOW' },
    });

    // Update patient record if linked
    if (appt.patientId) {
      await prisma.patient.update({
        where: { id: appt.patientId },
        data: { status: 'NO_SHOW' },
      });
    }

    // Only notify if clinic has no-show alerts enabled
    if (appt.clinic.noShowAlerts) {
      await createNotification({
        clinicId: appt.clinicId,
        type: 'no_show',
        title: 'Patient did not arrive',
        body: `${appt.patientName || appt.patientPhone} had a ${appt.scheduledAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} appointment that was missed.`,
        metadata: {
          appointmentId: appt.id,
          patientPhone: appt.patientPhone,
          scheduledAt: appt.scheduledAt,
        },
      });
    }
  }
});

export async function scheduleNoShowDetector() {
  const existing = await noShowQueue.getRepeatableJobs();
  for (const job of existing) {
    await noShowQueue.removeRepeatableByKey(job.key);
  }

  // Every 30 minutes
  await noShowQueue.add('detect-no-shows', {}, { repeat: { cron: '*/30 * * * *' } });

  logger.info('No-show detector scheduled');
}
