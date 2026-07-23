import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import {
  getClinic, updateClinic, getWhatsappStatus,
  connectWhatsApp, disconnectWhatsApp, completeOnboarding,
  requestWhatsApp, whatsappReady, submitOtp,
} from './handlers';

const router = Router();

router.get('/', authenticate as any, getClinic as any);
router.patch('/', authenticate as any, requireRole('ADMIN') as any, updateClinic as any);
router.post('/complete-onboarding', authenticate as any, requireRole('ADMIN') as any, completeOnboarding as any);
router.get('/whatsapp-status', authenticate as any, getWhatsappStatus as any);

// Manual "concierge" WhatsApp connection (current live flow)
router.post('/request-whatsapp', authenticate as any, requireRole('ADMIN') as any, requestWhatsApp as any);
router.post('/whatsapp-ready', authenticate as any, requireRole('ADMIN') as any, whatsappReady as any);
router.post('/submit-otp', authenticate as any, requireRole('ADMIN') as any, submitOtp as any);

// Meta self-serve Embedded Signup (parked until Meta verification clears — the
// frontend no longer calls these, but they stay wired so we can switch back).
router.post('/connect-whatsapp', authenticate as any, requireRole('ADMIN') as any, connectWhatsApp as any);
router.post('/disconnect-whatsapp', authenticate as any, requireRole('ADMIN') as any, disconnectWhatsApp as any);

export default router;
