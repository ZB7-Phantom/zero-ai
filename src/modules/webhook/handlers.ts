import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
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
import { redis } from '../../config/redis';

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

// Verifies Meta's X-Hub-Signature-256 HMAC over the raw request body.
// Returns true when the signature is valid (or verification is disabled).
function isValidSignature(req: Request): boolean {
  if (env.WEBHOOK_VERIFY_SIGNATURE !== 'true') return true; // gated off by default

  const header = req.get('x-hub-signature-256');
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!header || !rawBody) return false;

  const expected =
    'sha256=' + crypto.createHmac('sha256', env.META_APP_SECRET).update(rawBody).digest('hex');

  // Constant-time compare; timingSafeEqual throws on length mismatch, so guard.
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Meta calls POST /webhook/whatsapp for every event (messages, status updates, etc.)
export async function receive(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Reject forged/unsigned payloads before doing any work (when enabled).
  if (!isValidSignature(req)) {
    logger.warn('Webhook rejected — invalid X-Hub-Signature-256');
    res.sendStatus(401);
    return;
  }

  // Always respond 200 immediately — Meta will retry if we take too long
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const value = change.value;

        logger.info(`Full value keys: ${JSON.stringify(Object.keys(value))}`);
        logger.info(`Metadata: ${JSON.stringify(value.metadata)}`);
        logger.info(`Full value sample: ${JSON.stringify(value).slice(0, 500)}`);
        const phoneNumberId = value.metadata?.phone_number_id;
        const messages = value.messages;

        logger.info(`Incoming phoneNumberId: ${phoneNumberId}`);

        if (!messages?.length || !phoneNumberId) continue;

        // Resolve tenant by phoneNumberId
        const clinic = await prisma.clinic.findUnique({
          where: { phoneNumberId },
        });

        if (!clinic) {
          logger.warn('Unknown phoneNumberId — message dropped', { 
            phoneNumberId,
            receivedId: phoneNumberId,
          });
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

          // Prevent concurrent processing of the same conversation
          // Conversation lock — only if Redis is available
          let lockAcquired = false;
          const lockKey = `conv:lock:${conversation.id}`;
          
          const redisClient = redis;
          if (redisClient) {
            const locked = await redisClient.set(lockKey, '1', 'EX', 10, 'NX');
            if (!locked) {
              logger.info('Conversation locked — skipping concurrent message');
              continue;
            }
            lockAcquired = true;
          }

          try {
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

          // Reset if the last session was idle, or if
          // the conversation has been inactive for over 2 hours
          if (
            currentState.state === 'IDLE' ||
            sessionExpired
          ) {
            currentState.data = {};
            currentState.history = [];
            currentState.state = 'START';
          }

          // If waiting for confirmation and patient said yes,
          // force state to COMPLETE so brain generates queue confirmation
          logger.info(`Confirmation check — state: ${currentState.state}, message: "${messageText.trim()}"`);
          const isConfirmation =
            (currentState.state === 'AWAITING_CONFIRMATION' ||
             currentState.state === 'COLLECTING_SYMPTOMS') &&
            /^(yes|yeah|yep|correct|right|confirm|ok|okay|sure|yh|y)$/i
              .test(messageText.trim()) &&
            // Only treat as confirmation if we have all required fields
            !!(currentState.data as any).name &&
            !!(currentState.data as any).complaint;

          if (isConfirmation) {
            currentState.state = 'COMPLETE' as any;
          }

          // Assign queue number when intake completes
          let queueNumberForConfirmation: number | undefined;
          if (
            (currentState.state === 'AWAITING_CONFIRMATION' && isConfirmation) ||
            (currentState.state === 'COMPLETE' && currentState.data.mode === 'walkin')
          ) {
            // Only assign if not already assigned this session
            if (!(currentState.data as any).queueNumber) {
              queueNumberForConfirmation = await assignQueueNumber(clinic.id);
              currentState.data = {
                ...currentState.data,
                queueNumber: queueNumberForConfirmation,
              } as any;
            } else {
              queueNumberForConfirmation = (currentState.data as any).queueNumber;
            }
          }

          logger.info(`Pre-call state: ${currentState.state}, queueNum: ${queueNumberForConfirmation}`);
          const result = await processMessage(
            messageText,
            currentState,
            clinic,
            queueNumberForConfirmation
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

          logger.info('Conversation state saved', {
            newState: newState.state,
            dataKeys: Object.keys(newState.data),
          });

          let finalReply = result.reply;

          // If intake is complete, upsert the patient record
          if (result.isComplete && mergedData.name) {
            // Before the upsert, get the next queue number
            const queueNumber = queueNumberForConfirmation || await assignQueueNumber(clinic.id);

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
              // Parse date string — handle formats like "13th July 2026",
              // "July 13", "tomorrow", "Monday", ISO strings
              function parseAppointmentDateTime(
                dateStr: string,
                timeStr: string
              ): Date | null {
                try {
                  // Clean ordinal suffixes: "13th" → "13", "1st" → "1"
                  const cleanDate = dateStr.replace(/(\d+)(st|nd|rd|th)/gi, '$1');
                  // Normalize time: "2pm" → "14:00", "2:30pm" → "14:30"
                  const cleanTime = timeStr
                    .replace(/(\d+):?(\d*)\s*(am|pm)/i, (_, h, m, period) => {
                      let hour = parseInt(h);
                      const min = m ? parseInt(m) : 0;
                      if (period.toLowerCase() === 'pm' && hour < 12) hour += 12;
                      if (period.toLowerCase() === 'am' && hour === 12) hour = 0;
                      return `${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
                    });
                  const combined = `${cleanDate} ${cleanTime}`;
                  const parsed = new Date(combined);
                  if (!isNaN(parsed.getTime())) return parsed;
                  return null;
                } catch { return null; }
              }

              const scheduledAt = parseAppointmentDateTime(
                mergedData.appointmentDate as string,
                mergedData.appointmentTime as string
              );

              if (scheduledAt) {
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
          await sendWhatsAppMessage(
            phoneNumberId,
            patientPhone,
            finalReply,
            clinic.metaAccessToken || undefined
          );

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
          } finally {
            if (redisClient && lockAcquired) await redisClient.del(lockKey);
          }
        }
      }
    }
  } catch (err) {
    // Log but never let webhook processing crash the server
    logger.error('Webhook processing error', { 
      error: (err as Error).message,
      stack: (err as Error).stack?.slice(0, 500),
    });
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
