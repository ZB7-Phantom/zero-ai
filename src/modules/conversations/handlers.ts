import { Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { AppError } from '../../middleware/errorHandler';
import { AuthenticatedRequest } from '../../types';
import { io } from '../../app';
import { sendWhatsAppMessage } from '../../services/whatsapp/client';

// GET /api/conversations?status=NEEDS_REVIEW
// Powers the three sidebar tabs in ZeroChat. Returns conversation
// previews — not full message history, that's a separate call.
export async function listConversations(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const status = req.query.status as string | undefined;

    const conversations = await prisma.conversation.findMany({
      where: {
        clinicId: req.clinic.id,
        ...(status ? { status: status as any } : {}),
      },
      orderBy: { lastMessageAt: 'desc' },
      select: {
        id: true,
        patientName: true,
        patientPhone: true,
        status: true,
        escalationReason: true,
        lastMessageAt: true,
        lastMessagePreview: true,
        messageCount: true,
        isAiPaused: true,
      },
    });

    res.json(conversations);
  } catch (err) {
    next(err);
  }
}

// GET /api/conversations/counts
// Badge numbers for the three sidebar tabs — fetched separately
// from the list so the UI can show counts without loading full lists
export async function getConversationCounts(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const [needsReview, aiHandling, resolved] = await Promise.all([
      prisma.conversation.count({ where: { clinicId: req.clinic.id, status: 'NEEDS_REVIEW' } }),
      prisma.conversation.count({ where: { clinicId: req.clinic.id, status: 'AI_HANDLING' } }),
      prisma.conversation.count({ where: { clinicId: req.clinic.id, status: 'RESOLVED' } }),
    ]);

    res.json({ needsReview, aiHandling, resolved });
  } catch (err) {
    next(err);
  }
}

// GET /api/conversations/:id
// Full message thread — used when staff clicks into a conversation
export async function getConversation(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id as string, clinicId: req.clinic.id },
      include: {
        messages: {
          orderBy: { sentAt: 'asc' },
          include: { staffMember: { select: { fullName: true } } },
        },
      },
    });

    if (!conversation) throw new AppError(404, 'Conversation not found', 'NOT_FOUND');
    res.json(conversation);
  } catch (err) {
    next(err);
  }
}

// POST /api/conversations/:id/take-over
// Staff clicks "Take Over" — pauses Zero AI on this conversation
export async function takeOver(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id as string, clinicId: req.clinic.id },
    });
    if (!conversation) throw new AppError(404, 'Conversation not found', 'NOT_FOUND');

    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { isAiPaused: true, status: 'STAFF_TOOK_OVER' },
    });

    io.to(`clinic:${req.clinic.id}`).emit('conversation:updated', {
      conversationId: conversation.id,
      status: 'STAFF_TOOK_OVER',
    });

    logger.info('Staff took over conversation', {
      clinicId: req.clinic.id,
      conversationId: conversation.id,
      staffId: req.staff.id,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

// POST /api/conversations/:id/reply
// Staff sends a manual message — only works after Take Over
// (isAiPaused must be true, otherwise Zero and staff could collide)
export async function reply(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const { content } = req.body;
    if (!content) throw new AppError(400, 'content is required', 'VALIDATION_ERROR');

    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id as string, clinicId: req.clinic.id },
    });
    if (!conversation) throw new AppError(404, 'Conversation not found', 'NOT_FOUND');

    if (!conversation.isAiPaused) {
      throw new AppError(400, 'Take over the conversation before replying manually', 'AI_NOT_PAUSED');
    }

    if (!req.clinic.phoneNumberId) {
      throw new AppError(400, 'Clinic WhatsApp is not connected', 'WHATSAPP_NOT_CONNECTED');
    }

    // Save the staff message and update conversation metadata together
    const [message] = await prisma.$transaction([
      prisma.conversationMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'staff',
          staffMemberId: req.staff.id,
          content,
        },
      }),
      prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          messageCount: { increment: 1 },
          lastMessageAt: new Date(),
          lastMessagePreview: content.slice(0, 100),
        },
      }),
    ]);

    // Send to patient via WhatsApp
    await sendWhatsAppMessage(req.clinic.phoneNumberId, conversation.patientPhone, content);

    io.to(`clinic:${req.clinic.id}`).emit('conversation:updated', {
      conversationId: conversation.id,
      lastMessage: content,
    });

    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
}

// POST /api/conversations/:id/resolve
export async function resolve(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id as string, clinicId: req.clinic.id },
    });
    if (!conversation) throw new AppError(404, 'Conversation not found', 'NOT_FOUND');

    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedById: req.staff.id,
        isAiPaused: false, // Resolving hands control back to Zero for any future message
      },
    });

    io.to(`clinic:${req.clinic.id}`).emit('conversation:updated', {
      conversationId: conversation.id,
      status: 'RESOLVED',
    });

    logger.info('Conversation resolved', {
      clinicId: req.clinic.id,
      conversationId: conversation.id,
      staffId: req.staff.id,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}
