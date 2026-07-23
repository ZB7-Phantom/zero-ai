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
import { MarkConnectedSchema, ChangePlanSchema } from './schemas';
import { PLAN_PRICES, PLAN_ORDER } from './pricing';
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

// GET /api/admin/overview — platform-wide health tiles.
export async function overview(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [clinics, suspended, whatsappConnected, patients, conversations, staff, newThisMonth, activeByPlan] =
      await Promise.all([
        prisma.clinic.count(),
        prisma.clinic.count({ where: { suspendedAt: { not: null } } }),
        prisma.clinic.count({ where: { whatsappStatus: 'CONNECTED' } }),
        prisma.patient.count(),
        prisma.conversation.count(),
        prisma.staffMember.count(),
        prisma.clinic.count({ where: { createdAt: { gte: startOfMonth } } }),
        prisma.clinic.groupBy({ by: ['plan'], where: { suspendedAt: null }, _count: true }),
      ]);

    const mrr = activeByPlan.reduce((sum, g) => sum + PLAN_PRICES[g.plan] * g._count, 0);

    res.json({
      clinics,
      active: clinics - suspended,
      suspended,
      whatsappConnected,
      patients,
      conversations,
      staff,
      newThisMonth,
      mrr,
    });
  } catch (err) { next(err); }
}

// GET /api/admin/billing — plan breakdown, MRR, and renewals/expired lists.
export async function billing(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const now = new Date();
    const in14days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const grouped = await prisma.clinic.groupBy({
      by: ['plan'], where: { suspendedAt: null }, _count: true,
    });

    const byPlan = PLAN_ORDER.map((plan) => {
      const count = grouped.find((g) => g.plan === plan)?._count ?? 0;
      const monthly = PLAN_PRICES[plan];
      return { plan, count, monthly, revenue: count * monthly };
    });
    const mrr = byPlan.reduce((s, b) => s + b.revenue, 0);

    const summarySelect = { id: true, name: true, plan: true, planExpiresAt: true } as const;
    const [renewalsDue, expired] = await Promise.all([
      prisma.clinic.findMany({
        where: { suspendedAt: null, planExpiresAt: { gte: now, lte: in14days } },
        select: summarySelect,
        orderBy: { planExpiresAt: 'asc' },
      }),
      prisma.clinic.findMany({
        where: { suspendedAt: null, planExpiresAt: { lt: now } },
        select: summarySelect,
        orderBy: { planExpiresAt: 'asc' },
      }),
    ]);

    res.json({ mrr, byPlan, renewalsDue, expired });
  } catch (err) { next(err); }
}

// POST /api/admin/clinics/:id/plan — manual plan override.
export async function changePlan(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const { plan, planExpiresAt } = ChangePlanSchema.parse(req.body);

    const existing = await prisma.clinic.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError(404, 'Clinic not found', 'NOT_FOUND');

    const data: { plan: typeof plan; planExpiresAt?: Date | null } = { plan };
    if (planExpiresAt !== undefined) {
      data.planExpiresAt = planExpiresAt ? new Date(planExpiresAt) : null;
    }

    const updated = await prisma.clinic.update({ where: { id }, data });
    logger.info('Admin changed plan', { clinicId: id, plan, by: req.staff.email });
    res.json({ id, plan: updated.plan, planExpiresAt: updated.planExpiresAt });
  } catch (err) { next(err); }
}

// GET /api/admin/clinics — every clinic, with the counts the console table needs.
export async function listAllClinics(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const clinics = await prisma.clinic.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, plan: true, whatsappStatus: true,
        suspendedAt: true, createdAt: true,
        _count: { select: { patients: true, staffMembers: true } },
        staffMembers: {
          where: { role: 'ADMIN' },
          select: { email: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });

    res.json(clinics.map((c) => ({
      id: c.id,
      name: c.name,
      plan: c.plan,
      whatsappStatus: c.whatsappStatus,
      suspended: !!c.suspendedAt,
      adminEmail: c.staffMembers[0]?.email ?? null,
      patientCount: c._count.patients,
      staffCount: c._count.staffMembers,
      createdAt: c.createdAt,
    })));
  } catch (err) { next(err); }
}

// GET /api/admin/clinics/:id — full detail for one clinic.
export async function getClinicDetail(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const c = await prisma.clinic.findUnique({
      where: { id },
      include: {
        staffMembers: {
          select: { id: true, fullName: true, email: true, role: true, isActive: true, lastLoginAt: true },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { patients: true, appointments: true, conversations: true } },
      },
    });
    if (!c) throw new AppError(404, 'Clinic not found', 'NOT_FOUND');

    res.json({
      id: c.id,
      name: c.name,
      address: c.address,
      services: c.services,
      openDays: c.openDays,
      opensAt: c.opensAt,
      closesAt: c.closesAt,
      plan: c.plan,
      planExpiresAt: c.planExpiresAt,
      whatsappStatus: c.whatsappStatus,
      phoneNumber: c.phoneNumber,
      phoneNumberId: c.phoneNumberId,
      suspended: !!c.suspendedAt,
      suspendedAt: c.suspendedAt,
      onboardingCompletedAt: c.onboardingCompletedAt,
      createdAt: c.createdAt,
      staff: c.staffMembers,
      counts: {
        patients: c._count.patients,
        appointments: c._count.appointments,
        conversations: c._count.conversations,
      },
    });
  } catch (err) { next(err); }
}

// POST /api/admin/clinics/:id/suspend — switch a clinic off.
export async function suspendClinic(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const existing = await prisma.clinic.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError(404, 'Clinic not found', 'NOT_FOUND');

    await prisma.clinic.update({ where: { id }, data: { suspendedAt: new Date() } });
    logger.info('Admin suspended clinic', { clinicId: id, by: req.staff.email });
    res.json({ id, suspended: true });
  } catch (err) { next(err); }
}

// POST /api/admin/clinics/:id/reactivate — switch a clinic back on.
export async function reactivateClinic(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;
    const existing = await prisma.clinic.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError(404, 'Clinic not found', 'NOT_FOUND');

    await prisma.clinic.update({ where: { id }, data: { suspendedAt: null } });
    logger.info('Admin reactivated clinic', { clinicId: id, by: req.staff.email });
    res.json({ id, suspended: false });
  } catch (err) { next(err); }
}

// GET /api/admin/whatsapp-pipeline — clinics currently moving through (or done
// with) the manual WhatsApp connection flow. Skips clinics that never started it.
export async function whatsappPipeline(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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
