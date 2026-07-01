import { Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { AppError } from '../../middleware/errorHandler';
import { AuthenticatedRequest } from '../../types';
import { io } from '../../app';

function formatAppointment(a: any) {
  return {
    id: a.id,
    patientId: a.patientId,
    patientName: a.patientName,
    patientPhone: a.patientPhone,
    doctor: a.doctorName,
    date: new Date(a.scheduledAt).toISOString().split('T')[0],
    time: new Date(a.scheduledAt).toTimeString().slice(0, 5),
    visitType: a.service,
    status: a.status.toLowerCase(),
    bookedVia: a.bookedVia === 'whatsapp' ? 'zero' : 'manual',
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

// GET /api/appointments?from=2026-06-22&to=2026-06-28
// Returns appointments in a date range for the calendar view.
// Defaults to the current week if no range given.
export async function listAppointments(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const from = req.query.from ? new Date(req.query.from as string) : startOfWeek(new Date());
    const to = req.query.to ? new Date(req.query.to as string) : endOfWeek(new Date());

    const appointments = await prisma.appointment.findMany({
      where: {
        clinicId: req.clinic.id,
        scheduledAt: { gte: from, lte: to },
        status: { not: 'CANCELLED' },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    res.json(appointments.map(formatAppointment));
  } catch (err) {
    next(err);
  }
}

// Checks if a doctor already has an appointment at this exact time.
// Used by both WhatsApp booking (Zero) and manual dashboard booking.
async function hasConflict(
  clinicId: string,
  doctorName: string,
  scheduledAt: Date,
  excludeAppointmentId?: string
): Promise<boolean> {
  const conflict = await prisma.appointment.findFirst({
    where: {
      clinicId,
      doctorName,
      scheduledAt,
      status: { in: ['PENDING', 'CONFIRMED'] },
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
  });
  return !!conflict;
}

// POST /api/appointments — manual booking from the dashboard
// (+ New Appointment button)
export async function createAppointment(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const { patientName, patientPhone, scheduledAt, service, doctorName, notes } = req.body;

    if (!patientName || !patientPhone || !scheduledAt) {
      throw new AppError(400, 'patientName, patientPhone, and scheduledAt are required', 'VALIDATION_ERROR');
    }

    const slotTime = new Date(scheduledAt);

    if (doctorName && (await hasConflict(req.clinic.id, doctorName, slotTime))) {
      throw new AppError(409, 'This doctor already has an appointment at this time', 'SLOT_CONFLICT');
    }

    // Link to existing patient record if one exists for this phone
    const patient = await prisma.patient.findUnique({
      where: { clinicId_phone: { clinicId: req.clinic.id, phone: patientPhone } },
    });

    const appointment = await prisma.appointment.create({
      data: {
        clinicId: req.clinic.id,
        patientId: patient?.id,
        patientName,
        patientPhone,
        scheduledAt: slotTime,
        service,
        doctorName,
        notes,
        status: 'CONFIRMED',
        bookedVia: 'dashboard',
      },
    });

    // Keep the patient's nextAppointmentAt in sync — affects recall status
    if (patient) {
      await prisma.patient.update({
        where: { id: patient.id },
        data: { nextAppointmentAt: slotTime, recallStatus: 'UP_TO_DATE' },
      });
    }

    io.to(`clinic:${req.clinic.id}`).emit('appointment:created', { appointment });

    res.status(201).json(formatAppointment(appointment));
  } catch (err) {
    next(err);
  }
}

// PATCH /api/appointments/:id — reschedule, change status, or cancel
export async function updateAppointment(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const id = req.params.id as string;
    const { scheduledAt, status, doctorName, notes } = req.body;

    const existing = await prisma.appointment.findFirst({
      where: { id, clinicId: req.clinic.id },
    });
    if (!existing) throw new AppError(404, 'Appointment not found', 'NOT_FOUND');

    // Only check conflicts if the time or doctor is actually changing
    if (scheduledAt || doctorName) {
      const newTime = scheduledAt ? new Date(scheduledAt) : existing.scheduledAt;
      const newDoctor = doctorName || existing.doctorName;
      if (newDoctor && (await hasConflict(req.clinic.id, newDoctor, newTime, id))) {
        throw new AppError(409, 'This doctor already has an appointment at this time', 'SLOT_CONFLICT');
      }
    }

    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
        status: status as any,
        doctorName,
        notes,
      },
    });

    io.to(`clinic:${req.clinic.id}`).emit('appointment:updated', { appointment: updated });

    logger.info('Appointment updated', { clinicId: req.clinic.id, appointmentId: id, status });

    res.json(formatAppointment(updated));
  } catch (err) {
    next(err);
  }
}

// Internal helper used by Zero AI when a WhatsApp booking completes.
// Not an HTTP route — called directly from the webhook handler.
export async function bookAppointmentFromWhatsApp(
  clinicId: string,
  patientPhone: string,
  patientName: string,
  scheduledAt: Date,
  service?: string
): Promise<{ success: boolean; conflict?: boolean }> {
  // Zero does not assign a specific doctor — clinic staff do that later.
  // Conflict check is skipped here since no doctor is assigned yet.
  const patient = await prisma.patient.findUnique({
    where: { clinicId_phone: { clinicId, phone: patientPhone } },
  });

  const appointment = await prisma.appointment.create({
    data: {
      clinicId,
      patientId: patient?.id,
      patientName,
      patientPhone,
      scheduledAt,
      service,
      status: 'PENDING',
      bookedVia: 'whatsapp',
    },
  });

  if (patient) {
    await prisma.patient.update({
      where: { id: patient.id },
      data: { nextAppointmentAt: scheduledAt, recallStatus: 'UP_TO_DATE' },
    });
  }

  io.to(`clinic:${clinicId}`).emit('appointment:created', { appointment });

  return { success: true };
}

// Date helpers
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(date: Date): Date {
  const d = startOfWeek(date);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}
