import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { AuthenticatedRequest } from '../../types';
import { AddStaffSchema, UpdateStaffSchema } from './schemas';
import { sendEmail } from '../../services/email';
import { env } from '../../config/env';

const TEMP_PASSWORD = 'Zero@2026!';

export async function listStaff(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const staff = await prisma.staffMember.findMany({
      where: { clinicId: req.clinic.id, isActive: true },
      select: { id: true, fullName: true, email: true, role: true, specialization: true, whatsappNumber: true, lastLoginAt: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(staff);
  } catch (err) { next(err); }
}

export async function addStaff(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const data = AddStaffSchema.parse(req.body);

    const existing = await prisma.staffMember.findFirst({
      where: { clinicId: req.clinic.id, email: data.email },
    });
    if (existing) throw new AppError(409, 'Email already used in this clinic', 'EMAIL_TAKEN');

    const passwordHash = await bcrypt.hash(TEMP_PASSWORD, 12);
    const specialization = data.specialization ?? data.roleOrSpecialization;

    const staff = await prisma.staffMember.create({
      data: { 
        fullName: data.fullName,
        email: data.email,
        role: data.role,
        whatsappNumber: data.whatsappNumber,
        specialization, 
        clinicId: req.clinic.id, 
        passwordHash 
      },
      select: { id: true, fullName: true, email: true, role: true, specialization: true, whatsappNumber: true, lastLoginAt: true },
    });

    await sendEmail({
      to: data.email,
      subject: `You have been added to ${req.clinic.name} on Zero Clinic OS`,
      text: `Hi ${data.fullName},\n\n${req.staff.fullName} has added you to ${req.clinic.name} on Zero Clinic OS.\n\nYour temporary password is: Zero@2026!\n\nPlease log in and change your password immediately:\n${env.FRONTEND_URL}/login\n\nIf you were not expecting this, contact your clinic administrator.\n\n— Zero Clinic OS`,
    });

    res.status(201).json(staff);
  } catch (err) { next(err); }
}

export async function removeStaff(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string;

    // Prevent removing yourself
    if (id === req.staff.id) throw new AppError(400, 'Cannot remove your own account', 'SELF_REMOVE');

    await prisma.staffMember.update({
      where: { id, clinicId: req.clinic.id },
      data: { isActive: false },
    });

    res.json({ success: true });
  } catch (err) { next(err); }
}
