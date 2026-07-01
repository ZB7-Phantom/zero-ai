import { Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { AuthenticatedRequest } from '../../types';

// GET /api/patients
// Returns all patients for the clinic with recall status and conversation count.
// Supports ?recall=true to filter to recall-due patients only.
export async function listPatients(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const recallOnly = req.query.recall === 'true';

    const patients = await prisma.patient.findMany({
      where: {
        clinicId: req.clinic.id,
        ...(recallOnly ? { recallStatus: { in: ['OVERDUE', 'DUE_SOON'] } } : {}),
      },
      orderBy: { lastVisitAt: 'desc' },
      include: {
        _count: { select: { conversations: true } },
        appointments: {
          where: { status: { in: ['PENDING', 'CONFIRMED'] } },
          orderBy: { scheduledAt: 'asc' },
          take: 1,
          select: { scheduledAt: true },
        },
      },
    });

    const result = patients.map((p) => ({
      id: p.id,
      name: p.name,
      phone: p.phone,
      lastVisitAt: p.lastVisitAt,
      nextAppointmentAt: p.appointments[0]?.scheduledAt || null,
      recallStatus: p.recallStatus,
      conversationCount: p._count.conversations,
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
}

// GET /api/patients/:id
// Full patient detail — used when staff clicks "View" on a patient row
export async function getPatient(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const patient = await prisma.patient.findFirst({
      where: { id: req.params.id as string, clinicId: req.clinic.id },
      include: {
        appointments: { orderBy: { scheduledAt: 'desc' }, take: 5 },
        conversations: {
          orderBy: { lastMessageAt: 'desc' },
          take: 5,
          select: {
            id: true,
            status: true,
            lastMessageAt: true,
            lastMessagePreview: true,
            messageCount: true,
          },
        },
      },
    });

    if (!patient) throw new AppError(404, 'Patient not found', 'NOT_FOUND');

    const intakeNotes = {
      reportedSymptoms: patient.symptoms || '',
      structuredAnswers: [
        patient.complaint && { question: 'What brings you in today?', answer: patient.complaint },
        patient.symptoms && { question: 'Can you describe your symptoms?', answer: patient.symptoms },
        patient.urgency && { question: 'Urgency level', answer: patient.urgency },
      ].filter(Boolean),
    };

    const history = patient.appointments
      .filter((a: any) => a.status === 'COMPLETED')
      .map((a: any) => ({
        date: new Date(a.scheduledAt).toISOString().split('T')[0],
        doctor: a.doctorName || 'Unknown',
        reason: a.service || 'General',
        notes: a.notes || '',
      }));

    res.json({ ...patient, intakeNotes, history });
  } catch (err) {
    next(err);
  }
}

// POST /api/patients — manually add a patient record
export async function createPatient(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const { name, phone, age, gender, complaint } = req.body;
    if (!name || !phone) throw new AppError(400, 'name and phone are required', 'VALIDATION_ERROR');

    const patient = await prisma.patient.upsert({
      where: { clinicId_phone: { clinicId: req.clinic.id, phone } },
      create: { clinicId: req.clinic.id, name, phone, age, gender, complaint },
      update: { name, age, gender, complaint },
    });

    res.status(201).json(patient);
  } catch (err) {
    next(err);
  }
}
