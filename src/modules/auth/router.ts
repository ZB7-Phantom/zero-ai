import { Router } from 'express';
import {
  register, login, verifyEmail,
  resendVerification, forgotPassword,
  resetPassword, getMe,
} from './handlers';
import { authenticate } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rateLimiter';

const router = Router();

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/verify-email', authLimiter, verifyEmail);
router.post('/resend-verification', authLimiter, resendVerification);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);
router.get('/me', authenticate as any, getMe as any);

export default router;
