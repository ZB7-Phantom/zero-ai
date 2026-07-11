import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import { getClinic, updateClinic, getWhatsappStatus, completeOnboarding } from './handlers';

const router = Router();

router.get('/', authenticate as any, getClinic as any);
router.patch('/', authenticate as any, requireRole('ADMIN') as any, updateClinic as any);
router.post('/complete-onboarding', authenticate as any, requireRole('ADMIN') as any, completeOnboarding as any);
router.get('/whatsapp-status', authenticate as any, getWhatsappStatus as any);

export default router;
