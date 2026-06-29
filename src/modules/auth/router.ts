import { Router } from 'express';
import { register, login } from './handlers';
import { authLimiter } from '../../middleware/rateLimiter';

const router = Router();

// Rate limited — 10 attempts per 15 minutes per IP
router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);

export default router;
