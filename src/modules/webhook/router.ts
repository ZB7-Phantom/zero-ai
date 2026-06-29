import { Router } from 'express';
import { verify, receive } from './handlers';
import { webhookLimiter } from '../../middleware/rateLimiter';

const router = Router();

// GET — Meta webhook verification handshake
router.get('/whatsapp', verify);

// POST — inbound messages from Meta (rate limited, not auth-gated —
// Meta does not send JWT tokens)
router.post('/whatsapp', webhookLimiter, receive);

export default router;
