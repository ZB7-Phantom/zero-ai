import { Response, NextFunction } from 'express';
import axios from 'axios';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../middleware/errorHandler';
import { AuthenticatedRequest } from '../../types';
import { UpdateClinicSchema, normaliseClinicUpdate } from './schemas';

// Helper — converts DB clinic row to frontend shape
function formatClinic(clinic: any) {
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return {
    id: clinic.id,
    name: clinic.name,
    address: clinic.address,
    servicesOffered: clinic.services,
    operatingHours: {
      days: clinic.openDays.map((d: number) => DAYS[d]),
      openTime: clinic.opensAt,
      closeTime: clinic.closesAt,
    },
    whatsappStatus: clinic.whatsappStatus,
    phoneNumber: clinic.phoneNumber,
    plan: clinic.plan,
    escalationAlerts: clinic.escalationAlerts,
    recallReminders: clinic.recallReminders,
    noShowAlerts: clinic.noShowAlerts,
    dailySummaryEmail: clinic.dailySummaryEmail,
    createdAt: clinic.createdAt,
    updatedAt: clinic.updatedAt,
  };
}
// GET /api/clinic — return current clinic details
export async function getClinic(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const clinic = await prisma.clinic.findUnique({ where: { id: req.clinic.id } });
    if (!clinic) throw new AppError(404, 'Clinic not found', 'NOT_FOUND');
    res.json(formatClinic(clinic));
  } catch (err) { next(err); }
}

// PATCH /api/clinic — update clinic details (onboarding screen 2)
export async function updateClinic(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const raw = UpdateClinicSchema.parse(req.body);
    const data = normaliseClinicUpdate(raw);
    const clinic = await prisma.clinic.update({
      where: { id: req.clinic.id },
      data,
    });
    res.json(formatClinic(clinic));
  } catch (err) { next(err); }
}

// POST /api/clinic/complete-onboarding — marks the wizard as done for this clinic,
// server-side, so it doesn't need to be re-completed on every device that logs in.
export async function completeOnboarding(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const clinic = await prisma.clinic.update({
      where: { id: req.clinic.id },
      data: { onboardingCompletedAt: new Date() },
    });
    res.json(formatClinic(clinic));
  } catch (err) { next(err); }
}

// GET /api/clinic/whatsapp-status — onboarding screen 3
// Returns current WhatsApp connection state for the progress display
export async function getWhatsappStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const clinic = await prisma.clinic.findUnique({
      where: { id: req.clinic.id },
      select: { whatsappStatus: true, phoneNumber: true, phoneNumberId: true },
    });
    res.json(clinic);
  } catch (err) { next(err); }
}

/**
 * POST /api/clinic/connect-whatsapp
 *
 * Called by the frontend immediately after the clinic
 * completes Meta's Embedded Signup popup. Receives the
 * auth code and WABA details, exchanges for a permanent
 * token, stores credentials against the clinic record.
 *
 * After this call succeeds, the clinic's WhatsApp number
 * is live and Zero will receive their patients' messages.
 */
export async function connectWhatsApp(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const { code, phoneNumberId, wabaId, phoneNumber } = req.body;

    if (!code || !phoneNumberId || !wabaId) {
      throw new AppError(
        400,
        'code, phoneNumberId, and wabaId are required',
        'MISSING_FIELDS'
      );
    }

    // Exchange the short-lived auth code for a permanent
    // System User access token. This token is what Zero
    // uses to send WhatsApp messages on the clinic's behalf.
    const tokenResponse = await axios.get(
      'https://graph.facebook.com/v19.0/oauth/access_token',
      {
        params: {
          client_id: env.META_APP_ID,
          client_secret: env.META_APP_SECRET,
          code,
        },
      }
    );

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) {
      throw new AppError(502, 'Failed to exchange auth code', 'TOKEN_EXCHANGE_FAILED');
    }

    // Store credentials against the clinic record
    const clinic = await prisma.clinic.update({
      where: { id: req.clinic.id },
      data: {
        phoneNumberId,
        phoneNumber: phoneNumber || null,
        metaAccessToken: accessToken,
        whatsappStatus: 'CONNECTED',
      },
    });

    logger.info('Clinic connected WhatsApp', {
      clinicId: req.clinic.id,
      phoneNumberId,
      wabaId,
    });

    // Register the webhook subscription for this WABA
    // so Meta starts sending this clinic's messages to us
    try {
      await axios.post(
        `https://graph.facebook.com/v19.0/${wabaId}/subscribed_apps`,
        {},
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
    } catch (webhookErr) {
      // Non-fatal — clinic can still use Zero, webhook
      // subscription can be retried manually if needed
      logger.error('Webhook subscription failed', {
        clinicId: req.clinic.id,
        error: (webhookErr as Error).message,
      });
    }

    res.json({
      success: true,
      whatsappStatus: 'CONNECTED',
      phoneNumber: clinic.phoneNumber,
      phoneNumberId: clinic.phoneNumberId,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/clinic/disconnect-whatsapp
 *
 * Allows a clinic admin to disconnect their WhatsApp number.
 * Clears stored credentials and stops Zero from processing
 * their messages.
 */
export async function disconnectWhatsApp(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    await prisma.clinic.update({
      where: { id: req.clinic.id },
      data: {
        phoneNumberId: null,
        phoneNumber: null,
        metaAccessToken: null,
        whatsappStatus: 'NOT_CONNECTED',
      },
    });

    logger.info('Clinic disconnected WhatsApp', { clinicId: req.clinic.id });

    res.json({ success: true, whatsappStatus: 'NOT_CONNECTED' });
  } catch (err) {
    next(err);
  }
}
