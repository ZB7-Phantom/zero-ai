import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import {
  listConversations,
  getConversationCounts,
  getConversation,
  takeOver,
  reply,
  resolve,
} from './handlers';

const router = Router();

router.get('/', authenticate as any, listConversations as any);
router.get('/counts', authenticate as any, getConversationCounts as any);
router.get('/:id', authenticate as any, getConversation as any);
router.post('/:id/take-over', authenticate as any, takeOver as any);
router.post('/:id/reply', authenticate as any, reply as any);
router.post('/:id/resolve', authenticate as any, resolve as any);

export default router;
