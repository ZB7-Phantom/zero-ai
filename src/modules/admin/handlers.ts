/**
 * admin/handlers.ts — internal Zero-team dashboard for driving the manual
 * WhatsApp connection pipeline. Every route here is gated by
 * requirePlatformAdmin (see router). These are NOT clinic-facing.
 *
 * The pipeline, from the team's side:
 *   VERIFICATION_PENDING  — a clinic asked to connect; add their number to our
 *                           Meta Business Manager.
 *   → sendOtp             — once Meta is about to text the code, flip the clinic
 *                           to AWAITING_OTP so their screen asks for it.
 *   → (clinic enters code, it appears here)
 *   → markConnected       — after we verify the code on Meta's side and the
 *                           number is live, store its phoneNumberId and go live.
 */

import { Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { AppError } from '../../middleware/errorHandler';
import { AuthenticatedRequest } from '../../types';
import { MarkConnectedSchema } from './schemas';
import {
  notifyClinicEnterOtp,
  notifyClinicConnected,
} from '../../services/email/whatsappOnboarding';

// Shape returned to the admin dashboard for each clinic in the pipeline.
function formatPipelineClinic(c: any) {
  return {
    id: c.id,
    name: c.name,
    whatsappStatus: c.whatsappStatus,
    requestedNumber: c.whatsappRequestedNumber,
    setupChoice: c.whatsappSetupChoice,
    notifyEmail: c.whatsappNotifyEmail,
    requestedAt: c.whatsappRequestedAt,
    clinicReadyAt: c.whatsappClinicReadyAt,
    otpCode: c.whatsappOtpCode,
    otpSubmittedAt: c.whatsappOtpSubmittedAt,
    phoneNumber: c.phoneNumber,
    phoneNumberId: c.phoneNumberId,
  };
}

// GET /api/admin/clinics — clinics currently moving through (or done with) the
// manual connection flow. Skips clinics that never started it.
export async function listClinics(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const clinics = await prisma.clinic.findMany({
      where: {
        whatsappStatus: { in: ['VERIFICATION_PENDING', 'AWAITING_OTP', 'CONNECTED'] },
      },
      orderBy: { whatsappRequestedAt: 'desc' },
      select: {
        id: true, name: true, whatsappStatus: true,
        whatsappRequestedNumber: true, whatsappSetupChoice: true,
        whatsappNotifyEmail: true, whatsappRequestedAt: true,
        whatsappClinicReadyAt: true, whatsappOtpCode: true,
        whatsappOtpSubmittedAt: true, phoneNumber: true, phoneNumberId: true,
      },
    });
    res.json(clinics.map(formatPipelineClinic));
  } catch (err) { next(err); }
}

// POST /api/admin/clinics/:id/send-otp — the team is about to (or just did)
// trigger Meta to text the code. Flip the clinic to AWAITING_OTP so their
// screen switches to code entry, and email them to enter it now.
export async function sendOtp(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const existing = await prisma.clinic.findUnique({
      where: { id }, select: { whatsappStatus: true },
    });
    if (!existing) throw new AppError(404, 'Clinic not found', 'NOT_FOUND');

    const clinic = await prisma.clinic.update({
      where: { id },
      data: {
        whatsappStatus: 'AWAITING_OTP',
        // Clear any previous code so a resend starts clean
        whatsappOtpCode: null,
        whatsappOtpSubmittedAt: null,
      },
    });

    logger.info('Admin triggered OTP send', { clinicId: id, by: req.staff.email });
    notifyClinicEnterOtp(clinic);

    res.json(formatPipelineClinic(clinic));
  } catch (err) { next(err); }
}

// POST /api/admin/clinics/:id/mark-connected — the number is verified and live
// on our WABA. Store its phoneNumberId (routes inbound webhooks here), go
// CONNECTED, clear the code, and tell the clinic they're live.
export async function markConnected(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const { phoneNumberId, phoneNumber } = MarkConnectedSchema.parse(req.body);

    const existing = await prisma.clinic.findUnique({
      where: { id },
      select: { id: true, whatsappRequestedNumber: true },
    });
    if (!existing) throw new AppError(404, 'Clinic not found', 'NOT_FOUND');

    // phoneNumberId is unique across clinics — surface a clear conflict rather
    // than a raw Prisma error if it's already tied to another clinic.
    const clash = await prisma.clinic.findFirst({
      where: { phoneNumberId, id: { not: id } },
      select: { id: true, name: true },
    });
    if (clash) {
      throw new AppError(409, `That phone number ID is already connected to ${clash.name}`, 'PHONE_ID_TAKEN');
    }

    const clinic = await prisma.clinic.update({
      where: { id },
      data: {
        whatsappStatus: 'CONNECTED',
        phoneNumberId,
        phoneNumber: phoneNumber || existing.whatsappRequestedNumber || null,
        whatsappOtpCode: null,
        whatsappOtpSubmittedAt: null,
      },
    });

    logger.info('Admin marked clinic connected', { clinicId: id, by: req.staff.email });
    notifyClinicConnected(clinic);

    res.json(formatPipelineClinic(clinic));
  } catch (err) { next(err); }
}

// POST /api/admin/clinics/:id/reset — send the clinic back to the start (e.g.
// wrong number, or they want to redo it). Clears all manual-flow state.
export async function resetConnection(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const existing = await prisma.clinic.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError(404, 'Clinic not found', 'NOT_FOUND');

    const clinic = await prisma.clinic.update({
      where: { id },
      data: {
        whatsappStatus: 'NOT_CONNECTED',
        whatsappRequestedNumber: null,
        whatsappSetupChoice: null,
        whatsappRequestedAt: null,
        whatsappClinicReadyAt: null,
        whatsappOtpCode: null,
        whatsappOtpSubmittedAt: null,
      },
    });

    logger.info('Admin reset clinic WhatsApp connection', { clinicId: id, by: req.staff.email });
    res.json(formatPipelineClinic(clinic));
  } catch (err) { next(err); }
}
