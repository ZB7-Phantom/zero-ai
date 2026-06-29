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
