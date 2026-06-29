import { Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { AuthenticatedRequest } from '../../types';
import { UpdateClinicSchema } from './schemas';

// GET /api/clinic — return current clinic details
export async function getClinic(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const clinic = await prisma.clinic.findUnique({ where: { id: req.clinic.id } });
    if (!clinic) throw new AppError(404, 'Clinic not found', 'NOT_FOUND');
    res.json(clinic);
  } catch (err) { next(err); }
}

// PATCH /api/clinic — update clinic details (onboarding screen 2)
export async function updateClinic(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const data = UpdateClinicSchema.parse(req.body);
    const clinic = await prisma.clinic.update({ where: { id: req.clinic.id }, data });
    res.json(clinic);
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
