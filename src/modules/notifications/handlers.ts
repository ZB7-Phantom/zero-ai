import { Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { AuthenticatedRequest } from '../../types';

// GET /api/notifications
// Returns unread notifications for the clinic, newest first.
// Powers the bell icon and the "Needs Attention" panel.
export async function listNotifications(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const notifications = await prisma.notification.findMany({
      where: {
        clinicId: req.clinic.id,
        isRead: false,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(notifications);
  } catch (err) {
    next(err);
  }
}

// PATCH /api/notifications/:id/read
// Staff dismisses a notification
export async function markRead(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const notification = await prisma.notification.updateMany({
      where: { id: req.params.id as string, clinicId: req.clinic.id },
      data: { isRead: true, readAt: new Date() },
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/notifications/read-all
// Staff clears all notifications at once
export async function markAllRead(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    await prisma.notification.updateMany({
      where: { clinicId: req.clinic.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
