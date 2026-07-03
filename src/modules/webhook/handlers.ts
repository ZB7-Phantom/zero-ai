import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { env } from '../../config/env';
import { io } from '../../app';
import { sendWhatsAppMessage } from '../../services/whatsapp/client';
import { processMessage, getNextState } from '../../services/zero-ai/brain';
import { AiConversationState } from '../../types';
import { EscalationReason } from '@prisma/client';
import { assignQueueNumber } from '../queue/handlers';
import { bookAppointmentFromWhatsApp } from '../appointments/handlers';
import { createNotification } from '../../services/notifications/create';

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
          const conversation = await prisma.conversation.upsert({
            where: { clinicId_patientPhone: { clinicId: clinic.id, patientPhone } },
            create: {
              clinicId: clinic.id,
              patientPhone,
              patientName: value.contacts?.[0]?.profile?.name || null,
              aiState: { state: 'START', data: {}, history: [] } as any,
            },
            update: {}, // No update needed — just ensure it exists
          });

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

          // If previous session was complete or idle, reset data and
          // history so Zero starts the new conversation clean
          // Reset if the last session was complete, idle, or if
          // the conversation has been inactive for over 2 hours
          const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
          const lastActivity = conversation.lastMessageAt;
          const sessionExpired = lastActivity && lastActivity < twoHoursAgo;

          if (['COMPLETE', 'IDLE'].includes(currentState.state) || sessionExpired) {
            currentState.data = {};
            currentState.history = [];
            currentState.state = 'START';
          }

          // Determine if this message is likely to complete intake
          // so we can pre-assign a queue number for the confirmation message
          const isWalkinAboutToComplete =
            currentState.state === 'COLLECTING_SYMPTOMS' &&
            ((currentState.data as any).followUpCount || 0) >= 1 &&
            currentState.data.mode === 'walkin';

          let preAssignedQueueNumber: number | undefined;
          if (isWalkinAboutToComplete) {
            preAssignedQueueNumber = await assignQueueNumber(clinic.id);
          }

          const result = await processMessage(
            messageText,
            currentState,
            clinic,
            preAssignedQueueNumber
          );

          // Append this exchange to history
          const updatedHistory = [
            ...currentState.history,
            { role: 'user' as const, content: messageText },
            { role: 'model' as const, content: result.reply },
          ].slice(-50); // Keep last 50 turns maximum — full history
                        // is always in ConversationMessage table

          const norm = messageText.toLowerCase().trim();
          const intent = (() => {
            if (/^[1]$/.test(norm)) return 'WALKIN';
            if (/^[2]$/.test(norm)) return 'APPOINTMENT';
            if (/^[3]$/.test(norm)) return 'ON_MY_WAY';
            if (/^[4]$/.test(norm)) return 'QUEUE_CHECK';
            if (/^(restart|start over|menu)$/.test(norm)) return 'RESTART';
            if (!['START','MENU','IDLE','COMPLETE'].includes(currentState.state))
              return 'PROVIDING_DATA';
            return 'UNKNOWN';
          })() as any;

          const mergedData = {
            ...currentState.data,
            ...Object.fromEntries(
              Object.entries(result.extracted).filter(([, v]) => v !== null && v !== undefined)
            ),
          };

          const nextStateName = result.isComplete
            ? 'COMPLETE'
            : getNextState(currentState.state, intent, mergedData);

          logger.info(`Brain state debug — state: ${nextStateName}`);

          const newState: AiConversationState = {
            state: nextStateName as AiConversationState['state'],
            data: mergedData,
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

          logger.info(`Conversation state saved — newState: ${newState.state}, dataKeys: ${Object.keys(newState.data).join(',')}`);

          let finalReply = result.reply;

          // If intake is complete, upsert the patient record
          if (result.isComplete && mergedData.name) {
            // Before the upsert, get the next queue number
            const queueNumber = preAssignedQueueNumber || await assignQueueNumber(clinic.id);

            const department = (result as any)._department;
            const urgency = (result as any)._urgency;

            await prisma.$transaction(async (tx) => {
              await tx.patient.upsert({
                where: { clinicId_phone: { clinicId: clinic.id, phone: patientPhone } },
                create: {
                  clinicId: clinic.id,
                  phone: patientPhone,
                  name: mergedData.name,
                  age: mergedData.age ? parseInt(String(mergedData.age)) : null,
                  gender: mergedData.gender,
                  complaint: mergedData.complaint,
                  symptoms: mergedData.symptoms,
                  department: department || 'General',
                  urgency: urgency || 'LOW',
                  queueNumber,
                  patientType: 'WALK_IN',
                  status: 'WAITING',
                  arrivalTime: new Date(),
                },
                update: {
                  name: mergedData.name,
                  complaint: mergedData.complaint,
                  symptoms: mergedData.symptoms,
                  department: department || 'General',
                  urgency: urgency || 'LOW',
                  queueNumber,
                  status: 'WAITING',
                  arrivalTime: new Date(),
                },
              });
            });

            // If this was an appointment booking, create the Appointment record
            if (mergedData.mode === 'appointment' && mergedData.appointmentDate && mergedData.appointmentTime) {
              const scheduledAt = new Date(`${mergedData.appointmentDate} ${mergedData.appointmentTime}`);
              if (!isNaN(scheduledAt.getTime())) {
                await bookAppointmentFromWhatsApp(
                  clinic.id,
                  patientPhone,
                  mergedData.name as string,
                  scheduledAt,
                  mergedData.complaint
                );
              } else {
                logger.warn('Could not parse appointment date/time', {
                  date: mergedData.appointmentDate,
                  time: mergedData.appointmentTime,
                });
              }
            }
          }

          // Send reply to patient via WhatsApp
          await sendWhatsAppMessage(phoneNumberId, patientPhone, finalReply);

          // Emit real-time event to clinic dashboard via Socket.io
          io.to(`clinic:${clinic.id}`).emit('conversation:updated', {
            conversationId: conversation.id,
            patientPhone,
            status: conversationStatus,
            lastMessage: result.reply,
            escalated: result.escalate,
          });

          if (result.escalate) {
            const queueNumber = await assignQueueNumber(clinic.id);
            await prisma.patient.upsert({
              where: { clinicId_phone: { clinicId: clinic.id, phone: patientPhone } },
              create: {
                clinicId: clinic.id,
                phone: patientPhone,
                name: (currentState.data as any).name || patientPhone,
                complaint: (currentState.data as any).complaint || 'Escalated',
                queueNumber,
                patientType: 'WALK_IN',
                status: 'WAITING',
                arrivalTime: new Date(),
              },
              update: {
                name: (currentState.data as any).name || patientPhone,
                complaint: (currentState.data as any).complaint || 'Escalated',
                queueNumber,
                status: 'WAITING',
                arrivalTime: new Date(),
              },
            });

            io.to(`clinic:${clinic.id}`).emit('conversation:escalated', {
              conversationId: conversation.id,
              patientPhone,
              reason: result.escalationReason,
            });

            await createNotification({
              clinicId: clinic.id,
              type: 'escalation',
              title: escalationTitle(result.escalationReason),
              body: `Patient ${patientPhone} — ${result.escalationReason?.replace('_', ' ').toLowerCase()}. Click Review to take over.`,
              metadata: {
                conversationId: conversation.id,
                patientPhone,
                reason: result.escalationReason,
              },
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

function escalationTitle(reason: string | null): string {
  switch (reason) {
    case 'URGENT_MEDICAL':   return 'Symptom flagged as urgent';
    case 'BILLING_DISPUTE':  return 'Patient dispute — billing question';
    case 'PATIENT_ANGRY':    return 'Patient expressing frustration';
    case 'OUT_OF_SCOPE':     return 'Request outside clinic services';
    default:                 return 'Conversation needs review';
  }
}
