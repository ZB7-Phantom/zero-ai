import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { AppError } from '../../middleware/errorHandler';
import { AuthenticatedRequest } from '../../types';
import { io } from '../../app';
import { sendWhatsAppMessage } from '../../services/whatsapp/client';

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).map((n) => n[0]).join('').toUpperCase().substring(0, 2) || '?';
}

function formatWaitTime(arrivalTime: Date): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(arrivalTime).getTime()) / 60000));
  if (minutes < 1) return 'Just arrived';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return `${hours}h ${rem}m`;
}

// Shape must match the frontend's QueueEntry type (ZERO/src/features/live-queue/LiveQueuePage.tsx) —
// status stays the raw uppercase Prisma enum since that's what statusToTab's keys are.
function formatQueuePatient(p: any) {
  return {
    id: p.id,
    patientId: p.id,
    name: p.name || 'Unknown',
    initials: getInitials(p.name),
    phone: p.phone,
    queueNumber: p.queueNumber,
    arrivalTime: p.arrivalTime
      ? new Date(p.arrivalTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : '—',
    doctor: null, // Assigned at appointment level, not queue level
    reason: p.complaint || '—',
    waitTime: p.arrivalTime ? formatWaitTime(p.arrivalTime) : '—',
    status: p.status,
    source: p.patientType === 'WALK_IN' ? 'walk-in' : 'zero',
  };
}

// Gets today's queue for the clinic.
// Returns patients grouped by status for the Live Queue tabs.
export async function getLiveQueue(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const patients = await prisma.patient.findMany({
      where: {
        clinicId: req.clinic.id,
        arrivalTime: { gte: today, lt: tomorrow },
      },
      orderBy: [{ queueNumber: 'asc' }],
      select: {
        id: true,
        name: true,
        phone: true,
        queueNumber: true,
        status: true,
        patientType: true,
        complaint: true,
        department: true,
        urgency: true,
        arrivalTime: true,
        calledInAt: true,
        completedAt: true,
      },
    });

    // Group by status for the dashboard tabs
    const grouped = {
      waiting: patients.filter((p) => p.status === 'WAITING').map(formatQueuePatient),
      withDoctor: patients.filter((p) => p.status === 'WITH_DOCTOR').map(formatQueuePatient),
      completed: patients.filter((p) => p.status === 'COMPLETED').map(formatQueuePatient),
      noShow: patients.filter((p) => p.status === 'NO_SHOW').map(formatQueuePatient),
      total: patients.length,
    };

    res.json(grouped);
  } catch (err) {
    next(err);
  }
}

// Assigns the next queue number to a patient.
// Called by the webhook handler when Zero completes intake,
// and by the dashboard when staff manually adds a walk-in.
export async function assignQueueNumber(clinicId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Atomically increment the counter for today.
  // upsert creates the record if it doesn't exist yet (first patient of the day).
  const entry = await prisma.queueEntry.upsert({
    where: { clinicId_date: { clinicId, date: today } },
    create: { clinicId, date: today, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });

  return entry.lastNumber;
}

// PATCH /api/queue/patients/:id/status
// Staff calls this when moving a patient through the queue:
// WAITING → WITH_DOCTOR → COMPLETED or NO_SHOW
export async function updatePatientStatus(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const id = req.params.id as string;
    const status = req.body.status;

    const validTransitions: Record<string, string[]> = {
      WAITING: ['WITH_DOCTOR', 'NO_SHOW', 'CANCELLED'],
      WITH_DOCTOR: ['COMPLETED', 'WAITING'],
      COMPLETED: [],
      NO_SHOW: ['WAITING'],
      CANCELLED: [],
    };

    const patient = await prisma.patient.findFirst({
      where: { id, clinicId: req.clinic.id },
    });

    if (!patient) throw new AppError(404, 'Patient not found', 'NOT_FOUND');

    const allowed = validTransitions[patient.status] || [];
    if (!allowed.includes(status)) {
      throw new AppError(
        400,
        `Cannot transition from ${patient.status} to ${status}`,
        'INVALID_TRANSITION'
      );
    }

    const updated = await prisma.patient.update({
      where: { id },
      data: {
        status: status as any,
        calledInAt: status === 'WITH_DOCTOR' ? new Date() : undefined,
        completedAt: status === 'COMPLETED' ? new Date() : undefined,
        lastVisitAt: status === 'COMPLETED' ? new Date() : undefined,
      },
    });

    if (status === 'WITH_DOCTOR' && patient.phone && req.clinic.phoneNumberId) {
      const message = `🏥 *${req.clinic.name}*\n\nHello${patient.name ? ' *' + patient.name + '*' : ''}, it's your turn! 🎉\n\nPlease make your way to the reception desk now. The doctor is ready to see you.`;
      await sendWhatsAppMessage(req.clinic.phoneNumberId, patient.phone, message);
    }

    // Push real-time update to clinic dashboard
    io.to(`clinic:${req.clinic.id}`).emit('queue:updated', {
      patientId: id,
      status,
    });

    logger.info('Patient status updated', {
      clinicId: req.clinic.id,
      patientId: id,
      from: patient.status,
      to: status,
    });

    res.json(formatQueuePatient(updated));
  } catch (err) {
    next(err);
  }
}

// POST /api/queue/walk-in
// Staff manually adds a walk-in from the dashboard (+ Add Walk-in button)
export async function addWalkIn(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const { name, phone, complaint, reason, department, doctor } = req.body;
    if (!name || !phone) throw new AppError(400, 'name and phone are required', 'VALIDATION_ERROR');

    // reason is the frontend's name for complaint
    const finalComplaint = complaint || reason;

    const queueNumber = await assignQueueNumber(req.clinic.id);

    const patient = await prisma.patient.upsert({
      where: { clinicId_phone: { clinicId: req.clinic.id, phone } },
      create: {
        clinicId: req.clinic.id,
        phone,
        name,
        complaint: finalComplaint,
        department,
        queueNumber,
        patientType: 'WALK_IN',
        status: 'WAITING',
        arrivalTime: new Date(),
      },
      update: {
        name,
        complaint: finalComplaint,
        department,
        queueNumber,
        status: 'WAITING',
        arrivalTime: new Date(),
      },
    });

    io.to(`clinic:${req.clinic.id}`).emit('queue:patient-added', { patient: formatQueuePatient(patient) });

    res.status(201).json(formatQueuePatient(patient));
  } catch (err) {
    next(err);
  }
}

// GET /api/queue/stats
// Dashboard header stats: waiting count, with doctor count, completed today
export async function getQueueStats(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [waiting, withDoctor, completed, noShow] = await Promise.all([
      prisma.patient.count({ where: { clinicId: req.clinic.id, status: 'WAITING', arrivalTime: { gte: today } } }),
      prisma.patient.count({ where: { clinicId: req.clinic.id, status: 'WITH_DOCTOR', arrivalTime: { gte: today } } }),
      prisma.patient.count({ where: { clinicId: req.clinic.id, status: 'COMPLETED', completedAt: { gte: today } } }),
      prisma.patient.count({ where: { clinicId: req.clinic.id, status: 'NO_SHOW', arrivalTime: { gte: today } } }),
    ]);

    res.json({ waiting, withDoctor, completed, noShow, total: waiting + withDoctor + completed + noShow });
  } catch (err) {
    next(err);
  }
}
