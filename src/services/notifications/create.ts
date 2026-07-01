import { prisma } from '../../config/database';
import { io } from '../../app';
import { logger } from '../../config/logger';

interface CreateNotificationInput {
  clinicId: string;
  type: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

// Creates a Notification row and pushes a real-time event to the
// clinic dashboard so the bell updates immediately without a refresh.
export async function createNotification(input: CreateNotificationInput) {
  try {
    const notification = await prisma.notification.create({
      data: {
        clinicId: input.clinicId,
        type: input.type,
        title: input.title,
        body: input.body,
        metadata: (input.metadata || {}) as any,
      },
    });

    io.to(`clinic:${input.clinicId}`).emit('notification:new', notification);

    return notification;
  } catch (err) {
    // Log but never throw — a notification failure should never
    // crash the operation that triggered it
    logger.error('Failed to create notification', {
      clinicId: input.clinicId,
      type: input.type,
      error: (err as Error).message,
    });
  }
}
