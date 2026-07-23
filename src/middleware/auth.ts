import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { AppError } from './errorHandler';
import { AuthenticatedRequest } from '../types';

export async function authenticate(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) throw new AppError(401, 'No token provided', 'UNAUTHORIZED');

    const { staffId, clinicId } = jwt.verify(token, env.JWT_SECRET) as { staffId: string; clinicId: string };

    const staff = await prisma.staffMember.findUnique({
      where: { id: staffId },
      include: { clinic: true },
    });

    if (!staff?.isActive || staff.clinicId !== clinicId)
      throw new AppError(401, 'Invalid or expired session', 'TOKEN_INVALID');

    // A suspended clinic is switched off — block its staff, except platform
    // admins (who need access to reactivate it from the admin console).
    if (staff.clinic.suspendedAt && !isPlatformAdminEmail(staff.email)) {
      throw new AppError(403, 'This clinic has been suspended. Please contact support.', 'CLINIC_SUSPENDED');
    }

    req.staff = staff;
    req.clinic = staff.clinic;
    next();
  } catch (err) {
    next(err);
  }
}

// Use after authenticate: router.patch('/settings', authenticate, requireRole('ADMIN'), handler)
export function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!roles.includes(req.staff.role)) {
      next(new AppError(403, 'Insufficient permissions', 'FORBIDDEN'));
      return;
    }
    next();
  };
}

// The set of Zero-team emails allowed into the internal admin dashboard.
// Parsed once from PLATFORM_ADMIN_EMAILS (comma-separated), lower-cased.
const PLATFORM_ADMIN_EMAILS = new Set(
  (env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

// True if the given email belongs to a Zero platform operator. Exported so the
// auth/me handler can surface an `isPlatformAdmin` flag to the frontend.
export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  return !!email && PLATFORM_ADMIN_EMAILS.has(email.toLowerCase());
}

// The list of platform-admin emails — used to send the team notifications
// about clinics moving through the manual WhatsApp connection pipeline.
export function getPlatformAdminEmails(): string[] {
  return [...PLATFORM_ADMIN_EMAILS];
}

// Gate for internal admin routes. Use after authenticate:
//   router.get('/clinics', authenticate, requirePlatformAdmin, handler)
// This is deliberately separate from requireRole('ADMIN') — a clinic's own
// admin is not a Zero platform operator.
export function requirePlatformAdmin(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  if (!isPlatformAdminEmail(req.staff?.email)) {
    next(new AppError(403, 'Admin access required', 'FORBIDDEN'));
    return;
  }
  next();
}
