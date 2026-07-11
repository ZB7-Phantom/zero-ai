import { Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { AuthenticatedRequest } from '../../types';
import { UpdateClinicSchema, normaliseClinicUpdate } from './schemas';

// Helper — converts DB clinic row to frontend shape
function formatClinic(clinic: any) {
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return {
    id: clinic.id,
    name: clinic.name,
    address: clinic.address,
    servicesOffered: clinic.services,
    operatingHours: {
      days: clinic.openDays.map((d: number) => DAYS[d]),
      openTime: clinic.opensAt,
      closeTime: clinic.closesAt,
    },
    whatsappStatus: clinic.whatsappStatus,
    phoneNumber: clinic.phoneNumber,
    plan: clinic.plan,
    escalationAlerts: clinic.escalationAlerts,
    recallReminders: clinic.recallReminders,
    noShowAlerts: clinic.noShowAlerts,
    dailySummaryEmail: clinic.dailySummaryEmail,
    createdAt: clinic.createdAt,
    updatedAt: clinic.updatedAt,
  };
}
// GET /api/clinic — return current clinic details
export async function getClinic(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const clinic = await prisma.clinic.findUnique({ where: { id: req.clinic.id } });
    if (!clinic) throw new AppError(404, 'Clinic not found', 'NOT_FOUND');
    res.json(formatClinic(clinic));
  } catch (err) { next(err); }
}

// PATCH /api/clinic — update clinic details (onboarding screen 2)
export async function updateClinic(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const raw = UpdateClinicSchema.parse(req.body);
    const data = normaliseClinicUpdate(raw);
    const clinic = await prisma.clinic.update({
      where: { id: req.clinic.id },
      data,
    });
    res.json(formatClinic(clinic));
  } catch (err) { next(err); }
}

// POST /api/clinic/complete-onboarding — marks the wizard as done for this clinic,
// server-side, so it doesn't need to be re-completed on every device that logs in.
export async function completeOnboarding(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const clinic = await prisma.clinic.update({
      where: { id: req.clinic.id },
      data: { onboardingCompletedAt: new Date() },
    });
    res.json(formatClinic(clinic));
  } catch (err) { next(err); }
}

// GET /api/clinic/whatsapp-status — onboarding screen 3
// Returns current WhatsApp connection state for the progress display
export async function getWhatsappStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const clinic = await prisma.clinic.findUnique({
      where: { id: req.clinic.id },
      select: { whatsappStatus: true, phoneNumber: true, phoneNumberId: true },
    });
    res.json(clinic);
  } catch (err) { next(err); }
}
