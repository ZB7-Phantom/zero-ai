import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import { getClinic, updateClinic, getWhatsappStatus, connectWhatsApp, disconnectWhatsApp, completeOnboarding } from './handlers';

const router = Router();

router.get('/', authenticate as any, getClinic as any);
router.patch('/', authenticate as any, requireRole('ADMIN') as any, updateClinic as any);
router.post('/complete-onboarding', authenticate as any, requireRole('ADMIN') as any, completeOnboarding as any);
router.get('/whatsapp-status', authenticate as any, getWhatsappStatus as any);
router.post('/connect-whatsapp', authenticate as any, requireRole('ADMIN') as any, connectWhatsApp as any);
router.post('/disconnect-whatsapp', authenticate as any, requireRole('ADMIN') as any, disconnectWhatsApp as any);

export default router;
