import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';
import { RegisterSchema, LoginSchema } from './schemas';

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { fullName, email, password, clinicName } = RegisterSchema.parse(req.body);

    // Check email not already in use across any clinic
    const existing = await prisma.staffMember.findFirst({ where: { email } });
    if (existing) throw new AppError(409, 'Email already registered', 'EMAIL_TAKEN');

    const passwordHash = await bcrypt.hash(password, 12);

    // Create clinic and admin staff member together
    const clinic = await prisma.clinic.create({
      data: {
        name: clinicName,
        staffMembers: {
          create: { fullName, email, passwordHash, role: 'ADMIN' },
        },
      },
      include: { staffMembers: true },
    });

    const staff = clinic.staffMembers[0];
    const token = jwt.sign(
      { staffId: staff.id, clinicId: clinic.id, role: staff.role },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN as any }
    );

    res.status(201).json({ token, staff: { id: staff.id, fullName, email, role: staff.role }, clinic: { id: clinic.id, name: clinic.name } });
  } catch (err) { next(err); }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = LoginSchema.parse(req.body);

    const staff = await prisma.staffMember.findFirst({
      where: { email, isActive: true },
      include: { clinic: true },
    });

    if (!staff) throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');

    const valid = await bcrypt.compare(password, staff.passwordHash);
    if (!valid) throw new AppError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');

    // Update last login timestamp
    await prisma.staffMember.update({
      where: { id: staff.id },
      data: { lastLoginAt: new Date() },
    });

    const token = jwt.sign(
      { staffId: staff.id, clinicId: staff.clinicId, role: staff.role },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN as any }
    );

    res.json({ token, staff: { id: staff.id, fullName: staff.fullName, email: staff.email, role: staff.role }, clinic: { id: staff.clinic.id, name: staff.clinic.name } });
  } catch (err) { next(err); }
}
