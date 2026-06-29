import { Router, RequestHandler } from 'express';
import { authenticate } from '../../middleware/auth';
import { getLiveQueue, updatePatientStatus, addWalkIn, getQueueStats } from './handlers';

const router = Router();

router.get('/', authenticate as any, getLiveQueue as any);
router.get('/stats', authenticate as any, getQueueStats as any);
router.post('/walk-in', authenticate as any, addWalkIn as any);
router.patch('/patients/:id/status', authenticate as any, updatePatientStatus as any);

export default router;
