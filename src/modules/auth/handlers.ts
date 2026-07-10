import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';
import {
  RegisterSchema, LoginSchema, ResendVerificationSchema,
  ForgotPasswordSchema, ResetPasswordSchema,
} from './schemas';
import { sendEmail } from '../../services/email';
import { AuthenticatedRequest } from '../../types';
import { logger } from '../../config/logger';

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

    const verifyToken = randomBytes(32).toString('hex');
    const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Save token to staff member
    await prisma.staffMember.update({
      where: { id: staff.id },
      data: {
        emailVerifyToken: verifyToken,
        emailVerifyExpiry: verifyExpiry,
      },
    });

    // Fire the verification email without awaiting it — SMTP can be slow
    // (or blocked/hanging on some hosts), and the client shouldn't have
    // to wait on it to get their token back. sendEmail() already catches
    // and logs its own errors internally, so this never throws.
    const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${verifyToken}`;
    sendEmail({
      to: email,
      subject: `Verify your Zero Clinic OS account`,
      text: `Hi ${fullName},\n\nWelcome to Zero Clinic OS.\n\nPlease verify your email address to activate your account:\n\n${verifyUrl}\n\nThis link expires in 24 hours.\n\nIf you did not create this account, you can ignore this email.\n\n— Zero Clinic OS`,
    });

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

    const staffCount = await prisma.staffMember.count({
      where: { clinicId: staff.clinicId, isActive: true },
    });

    const onboardingComplete = !!(
      staff.clinic.address &&
      staff.clinic.services.length > 0 &&
      staffCount > 1
    );

    res.json({ token, staff: { id: staff.id, fullName: staff.fullName, email: staff.email, role: staff.role }, clinic: { id: staff.clinic.id, name: staff.clinic.name }, onboardingComplete });
  } catch (err) { next(err); }
}

export async function verifyEmail(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { token } = req.body;
    if (!token) throw new AppError(400, 'Token is required', 'MISSING_TOKEN');

    const staff = await prisma.staffMember.findUnique({
      where: { emailVerifyToken: token },
    });

    if (!staff) throw new AppError(400, 'Invalid or expired token', 'INVALID_TOKEN');
    if (staff.emailVerifyExpiry && staff.emailVerifyExpiry < new Date()) {
      throw new AppError(400, 'Verification link has expired', 'TOKEN_EXPIRED');
    }

    await prisma.staffMember.update({
      where: { id: staff.id },
      data: {
        emailVerified: true,
        emailVerifyToken: null,
        emailVerifyExpiry: null,
      },
    });

    res.json({ success: true, message: 'Email verified successfully' });
  } catch (err) { next(err); }
}

// Resend verification email
export async function resendVerification(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { email } = ResendVerificationSchema.parse(req.body);

    const staff = await prisma.staffMember.findFirst({ where: { email } });

    // Always return success to prevent email enumeration
    if (!staff || staff.emailVerified) {
      res.json({ success: true });
      return;
    }

    const verifyToken = randomBytes(32).toString('hex');
    const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.staffMember.update({
      where: { id: staff.id },
      data: { emailVerifyToken: verifyToken, emailVerifyExpiry: verifyExpiry },
    });

    const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${verifyToken}`;
    sendEmail({
      to: email,
      subject: 'Verify your Zero Clinic OS account',
      text: `Please verify your email:\n\n${verifyUrl}\n\nThis link expires in 24 hours.\n\n— Zero Clinic OS`,
    });

    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function forgotPassword(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { email } = ForgotPasswordSchema.parse(req.body);

    const staff = await prisma.staffMember.findFirst({ where: { email } });

    // Always return success — never confirm if email exists
    if (!staff) {
      res.json({ success: true });
      return;
    }

    const resetToken = randomBytes(32).toString('hex');
    const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.staffMember.update({
      where: { id: staff.id },
      data: {
        passwordResetToken: resetToken,
        passwordResetExpiry: resetExpiry,
      },
    });

    const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    sendEmail({
      to: email,
      subject: 'Reset your Zero Clinic OS password',
      text: `Hi ${staff.fullName},\n\nWe received a request to reset your password.\n\nClick the link below to set a new password:\n\n${resetUrl}\n\nThis link expires in 1 hour. If you did not request this, you can safely ignore this email.\n\n— Zero Clinic OS`,
    });

    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function resetPassword(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { token, password } = ResetPasswordSchema.parse(req.body);

    const staff = await prisma.staffMember.findUnique({
      where: { passwordResetToken: token },
    });

    if (!staff) throw new AppError(400, 'Invalid or expired reset link', 'INVALID_TOKEN');
    if (staff.passwordResetExpiry && staff.passwordResetExpiry < new Date()) {
      throw new AppError(400, 'Reset link has expired — request a new one', 'TOKEN_EXPIRED');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.staffMember.update({
      where: { id: staff.id },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpiry: null,
      },
    });

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) { next(err); }
}

export async function getMe(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const staff = await prisma.staffMember.findUnique({
      where: { id: req.staff.id },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        emailVerified: true,
        clinic: {
          select: {
            id: true, name: true, address: true,
            services: true, whatsappStatus: true, plan: true,
          },
        },
      },
    });

    if (!staff) throw new AppError(401, 'Session invalid', 'UNAUTHORIZED');

    const staffCount = await prisma.staffMember.count({
      where: { clinicId: req.clinic.id, isActive: true },
    });

    const onboardingComplete = !!(
      staff.clinic.address &&
      staff.clinic.services.length > 0 &&
      staffCount > 1
    );

    res.json({ staff, clinic: staff.clinic, onboardingComplete });
  } catch (err) { next(err); }
}
