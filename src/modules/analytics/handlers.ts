import { Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { AuthenticatedRequest } from '../../types';

export async function getDashboardSummary(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const clinicId = req.clinic.id;
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - 6);
    weekStart.setHours(0,0,0,0);

    const [
      patientsToday,
      doctorsOnDuty,
      conversationsNeedingAttention,
      conversationsHandledToday,
      escalatedToStaff,
      queueWaiting,
      queueWithDoctor,
      queueCompleted,
      todaysAppointments,
      needsAttentionItems,
      weeklyBookings,
    ] = await Promise.all([
      // Patients who arrived today
      prisma.patient.count({
        where: { clinicId, arrivalTime: { gte: todayStart } },
      }),
      // Active physicians
      prisma.staffMember.count({
        where: { clinicId, role: 'PHYSICIAN', isActive: true },
      }),
      // Unresolved escalations
      prisma.conversation.count({
        where: { clinicId, status: 'NEEDS_REVIEW' },
      }),
      // Conversations AI touched today
      prisma.conversation.count({
        where: { clinicId, updatedAt: { gte: todayStart } },
      }),
      // Conversations escalated to staff today
      prisma.conversation.count({
        where: { clinicId, status: 'NEEDS_REVIEW', updatedAt: { gte: todayStart } },
      }),
      prisma.patient.count({ where: { clinicId, status: 'WAITING', arrivalTime: { gte: todayStart } } }),
      prisma.patient.count({ where: { clinicId, status: 'WITH_DOCTOR', arrivalTime: { gte: todayStart } } }),
      prisma.patient.count({ where: { clinicId, status: 'COMPLETED', completedAt: { gte: todayStart } } }),
      // Today's appointments
      prisma.appointment.findMany({
        where: {
          clinicId,
          scheduledAt: { gte: todayStart },
          status: { not: 'CANCELLED' },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 10,
        select: {
          id: true, patientName: true, patientPhone: true,
          scheduledAt: true, service: true, doctorName: true, status: true,
        },
      }),
      // Unread notifications for "Needs Attention" panel
      prisma.notification.findMany({
        where: { clinicId, isRead: false },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true, type: true, title: true, body: true,
          createdAt: true, metadata: true,
        },
      }),
      // Last 7 days booking counts for weekly trend
      prisma.appointment.groupBy({
        by: ['scheduledAt'],
        where: { clinicId, scheduledAt: { gte: weekStart } },
        _count: true,
      }),
    ]);

    // Shape todaysAppointments to frontend naming
    const appointments = todaysAppointments.map((a) => ({
      id: a.id,
      patientName: a.patientName,
      patientPhone: a.patientPhone,
      doctor: a.doctorName,
      date: a.scheduledAt.toISOString().split('T')[0],
      time: a.scheduledAt.toTimeString().slice(0,5),
      visitType: a.service,
      status: a.status.toLowerCase(),
      bookedVia: 'zero',
    }));

    // Shape needs attention items
    const needsAttention = needsAttentionItems.map((n) => ({
      type: n.type as 'escalation' | 'recall' | 'noshow',
      severity: n.type === 'escalation' ? 'urgent' : 'warning',
      description: n.body,
      timestamp: n.createdAt.toISOString(),
      linkTo: {
        screen: n.type === 'escalation' ? 'conversations' : n.type === 'noshow' ? 'queue' : 'patients',
        id: (n.metadata as any)?.conversationId || (n.metadata as any)?.appointmentId || '',
      },
    }));

    // Build 7-day trend
    const days: string[] = [];
    const totalBookings: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const label = d.toLocaleDateString('en-US', { weekday: 'short' });
      days.push(label);
      totalBookings.push(0);
    }

    const autonomyRate = conversationsHandledToday > 0
      ? Math.round(((conversationsHandledToday - escalatedToStaff) / conversationsHandledToday) * 100)
      : 100;

    res.json({
      clinicName: req.clinic.name,
      patientsToday,
      doctorsOnDuty,
      conversationsNeedingAttention,
      aiActivity: {
        conversationsHandledToday,
        escalatedToStaff,
        avgResponseTimeSeconds: 8, // Static for now — real calc in D10
      },
      queueSnapshot: {
        waiting: queueWaiting,
        withDoctor: queueWithDoctor,
        completedToday: queueCompleted,
      },
      todaysAppointments: appointments,
      needsAttention,
      weeklyTrend: {
        days,
        totalBookings,
        aiHandled: totalBookings.map(() => 0), // Real data in D10
      },
      aiAutonomy: {
        autonomyRatePercent: autonomyRate,
        autopilotSessions: conversationsHandledToday - escalatedToStaff,
        manualEscalations: escalatedToStaff,
        recallSuccessRatePercent: 0, // Real calc in D10
        insightLine: `Zero automated ${autonomyRate}% of patient conversations today.`,
      },
    });
  } catch (err) { next(err); }
}
