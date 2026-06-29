import Bull from 'bull';
import { redis } from '../../config/redis';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';

// Queue for daily midnight jobs
export const dailyJobQueue = new Bull('daily-jobs', { redis: { ...redis.options } });

// Runs once per day — resets daily counters and updates recall status
dailyJobQueue.process('midnight-reset', async () => {
  logger.info('Running midnight reset job');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Mark patients with no upcoming appointment as OVERDUE if last visit
  // was more than 90 days ago, DUE_SOON if 60-90 days ago
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const sixtyDaysAgo = new Date(today);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  await Promise.all([
    // OVERDUE: last visit over 90 days ago, no upcoming appointment
    prisma.patient.updateMany({
      where: {
        lastVisitAt: { lt: ninetyDaysAgo },
        nextAppointmentAt: null,
        recallStatus: { not: 'OVERDUE' },
      },
      data: { recallStatus: 'OVERDUE' },
    }),
    // DUE_SOON: last visit 60-90 days ago, no upcoming appointment
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
});

// Schedule the job to run every day at midnight UTC
export async function scheduleMidnightReset() {
  // Remove any existing repeating job before adding a new one
  // to prevent duplicate schedules on server restart
  const existing = await dailyJobQueue.getRepeatableJobs();
  for (const job of existing) {
    await dailyJobQueue.removeRepeatableByKey(job.key);
  }

  await dailyJobQueue.add(
    'midnight-reset',
    {},
    { repeat: { cron: '0 0 * * *' } }
  );

  logger.info('Midnight reset job scheduled');
}
