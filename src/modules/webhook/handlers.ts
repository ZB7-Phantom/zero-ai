import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { env } from '../../config/env';
import { io } from '../../app';
import { sendWhatsAppMessage } from '../../services/whatsapp/client';
import { processMessage } from '../../services/zero-ai/brain';
import { AiConversationState } from '../../types';
import { EscalationReason } from '@prisma/client';
import { assignQueueNumber } from '../queue/handlers';
import { bookAppointmentFromWhatsApp } from '../appointments/handlers';

// Meta calls GET /webhook/whatsapp to verify the endpoint.
// We confirm by echoing back the hub.challenge value.
export function verify(req: Request, res: Response): void {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.META_VERIFY_TOKEN) {
    logger.info('WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
}

// Meta calls POST /webhook/whatsapp for every event (messages, status updates, etc.)
export async function receive(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Always respond 200 immediately — Meta will retry if we take too long
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        const phoneNumberId = value.metadata?.phone_number_id;
        const messages = value.messages;

        if (!messages?.length || !phoneNumberId) continue;

        // Resolve tenant by phoneNumberId
        const clinic = await prisma.clinic.findUnique({
          where: { phoneNumberId },
        });

        if (!clinic) {
          logger.warn('Unknown phoneNumberId — message dropped', { phoneNumberId });
          continue;
        }

        for (const msg of messages) {
          // Only process text messages for now
          if (msg.type !== 'text' || !msg.text?.body) continue;

          const patientPhone = msg.from;
          const messageText = msg.text.body;
          const metaMessageId = msg.id;

          // Deduplicate — Meta sometimes delivers the same message twice
          const alreadyProcessed = await prisma.conversationMessage.findUnique({
            where: { metaMessageId },
          });
          if (alreadyProcessed) {
            logger.info('Duplicate message ignored', { metaMessageId });
            continue;
          }

          logger.info('Inbound message', { clinicId: clinic.id, from: patientPhone });

          // Find or create conversation for this patient
          let conversation = await prisma.conversation.findFirst({
            where: { clinicId: clinic.id, patientPhone },
          });

          if (!conversation) {
            conversation = await prisma.conversation.create({
              data: {
                clinicId: clinic.id,
                patientPhone,
                patientName: value.contacts?.[0]?.profile?.name || null,
                aiState: { state: 'START', data: {}, history: [] } as any,
              },
            });
          }

          // If staff took over, AI stays silent — message still saved
          if (conversation.isAiPaused) {
            await prisma.conversationMessage.create({
              data: {
                conversationId: conversation.id,
                role: 'patient',
                content: messageText,
                metaMessageId,
              },
            });
            continue;
          }

          // Load and parse current AI state
          const currentState = (conversation.aiState as unknown as AiConversationState) || {
            state: 'START',
            data: {},
            history: [],
          };

          // Run the AI brain
          const result = await processMessage(messageText, currentState, clinic);

          // Merge newly extracted fields into existing collected data
          const updatedData = {
            ...currentState.data,
            ...Object.fromEntries(
              Object.entries(result.extracted).filter(([, v]) => v !== null && v !== undefined)
            ),
          };

          // Append this exchange to history
          const updatedHistory = [
            ...currentState.history,
            { role: 'user' as const, content: messageText },
            { role: 'model' as const, content: result.reply },
          ];

          const newState: AiConversationState = {
            state: result.isComplete ? 'COMPLETE' : currentState.state,
            data: updatedData,
            history: updatedHistory,
          };

          // Determine conversation status based on AI result
          const conversationStatus = result.escalate ? 'NEEDS_REVIEW' : 'AI_HANDLING';

          // Save patient message, AI reply, and updated state atomically
          await prisma.$transaction([
            // Patient message
            prisma.conversationMessage.create({
              data: {
                conversationId: conversation.id,
                role: 'patient',
                content: messageText,
                metaMessageId,
              },
            }),
            // AI reply
            prisma.conversationMessage.create({
              data: {
                conversationId: conversation.id,
                role: 'ai',
                content: result.reply,
              },
            }),
            // Updated conversation state
            prisma.conversation.update({
              where: { id: conversation.id },
              data: {
                aiState: newState as any,
                status: conversationStatus,
                escalationReason: result.escalate
                  ? (result.escalationReason as EscalationReason)
                  : undefined,
                messageCount: { increment: 2 },
                lastMessageAt: new Date(),
                lastMessagePreview: messageText.slice(0, 100),
                patientName: conversation.patientName || value.contacts?.[0]?.profile?.name || null,
              },
            }),
          ]);

          // If intake is complete, upsert the patient record
          if (result.isComplete && updatedData.name) {
            // Before the upsert, get the next queue number
            const queueNumber = await assignQueueNumber(clinic.id);

            await prisma.patient.upsert({
              where: { clinicId_phone: { clinicId: clinic.id, phone: patientPhone } },
              create: {
                clinicId: clinic.id,
                phone: patientPhone,
                name: updatedData.name,
                age: updatedData.age ? parseInt(String(updatedData.age)) : null,
                gender: updatedData.gender,
                complaint: updatedData.complaint,
                symptoms: updatedData.symptoms,
                queueNumber,
                patientType: 'WALK_IN',
                status: 'WAITING',
                arrivalTime: new Date(),
              },
              update: {
                name: updatedData.name,
                complaint: updatedData.complaint,
                symptoms: updatedData.symptoms,
                queueNumber,
                status: 'WAITING',
                arrivalTime: new Date(),
              },
            });

            // If this was an appointment booking, create the Appointment record
            if (updatedData.mode === 'appointment' && updatedData.appointmentDate && updatedData.appointmentTime) {
              const scheduledAt = new Date(`${updatedData.appointmentDate} ${updatedData.appointmentTime}`);
              if (!isNaN(scheduledAt.getTime())) {
                await bookAppointmentFromWhatsApp(
                  clinic.id,
                  patientPhone,
                  updatedData.name,
                  scheduledAt,
                  updatedData.complaint
                );
              } else {
                logger.warn('Could not parse appointment date/time', {
                  date: updatedData.appointmentDate,
                  time: updatedData.appointmentTime,
                });
              }
            }
          }

          // Send reply to patient via WhatsApp
          await sendWhatsAppMessage(phoneNumberId, patientPhone, result.reply);

          // Emit real-time event to clinic dashboard via Socket.io
          io.to(`clinic:${clinic.id}`).emit('conversation:updated', {
            conversationId: conversation.id,
            patientPhone,
            status: conversationStatus,
            lastMessage: result.reply,
            escalated: result.escalate,
          });

          if (result.escalate) {
            io.to(`clinic:${clinic.id}`).emit('conversation:escalated', {
              conversationId: conversation.id,
              patientPhone,
              reason: result.escalationReason,
            });
            logger.warn('Conversation escalated', {
              clinicId: clinic.id,
              conversationId: conversation.id,
              reason: result.escalationReason,
            });
          }
        }
      }
    }
  } catch (err) {
    // Log but never let webhook processing crash the server
    logger.error('Webhook processing error', { error: (err as Error).message });
  }
}
