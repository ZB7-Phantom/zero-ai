import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { listNotifications, markRead, markAllRead } from './handlers';

const router = Router();

router.get('/', authenticate as any, listNotifications as any);
router.patch('/read-all', authenticate as any, markAllRead as any);
router.patch('/:id/read', authenticate as any, markRead as any);

export default router;
