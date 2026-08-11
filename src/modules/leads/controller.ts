import { Request, Response } from 'express';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import axios from 'axios';

export const submitDemoRequest = async (req: Request, res: Response) => {
  try {
    const { clinicName, contactName, whatsapp, email, clinicType } = req.body;

    if (!clinicName || !contactName || !whatsapp || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Save to database
    const lead = await prisma.demoLead.create({
      data: {
        clinicName,
        contactName,
        whatsapp,
        email,
        clinicType: clinicType || 'General',
      },
    });

    logger.info(`New demo lead created: ${lead.id} - ${clinicName}`);

    // Send email via Resend
    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      try {
        await axios.post(
          'https://api.resend.com/emails',
          {
            from: 'Zero Leads <leads@getzero.ai>', // Use appropriate sending domain if verified, else onboarding@resend.dev
            to: ['mark@getzero.ai', 'victor@getzero.ai'], // Update with actual recipients or placeholders
            subject: `New Demo Request: ${clinicName}`,
            html: `
              <h2>New Demo Request</h2>
              <p><strong>Clinic:</strong> ${clinicName}</p>
              <p><strong>Contact:</strong> ${contactName}</p>
              <p><strong>WhatsApp:</strong> ${whatsapp}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Type:</strong> ${clinicType}</p>
            `,
          },
          {
            headers: {
              Authorization: `Bearer ${resendApiKey}`,
              'Content-Type': 'application/json',
            },
          }
        );
        logger.info('Demo lead email notification sent via Resend');
      } catch (emailError: any) {
        logger.error(`Failed to send Resend email: ${emailError.message}`);
      }
    } else {
      logger.info('RESEND_API_KEY not set. Falling back to logger for demo notification.');
      logger.info(`Demo Request Payload: ${JSON.stringify(req.body)}`);
    }

    return res.status(201).json({ success: true, leadId: lead.id });
  } catch (error: any) {
    logger.error(`Error processing demo request: ${error.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
