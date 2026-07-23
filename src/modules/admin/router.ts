import { Router } from 'express';
import { authenticate, requirePlatformAdmin } from '../../middleware/auth';
import { listClinics, sendOtp, markConnected, resetConnection } from './handlers';

// Internal Zero-team routes. Every route requires a valid session AND that the
// caller's email is in PLATFORM_ADMIN_EMAILS — a clinic's own ADMIN role is not
// enough. Mounted at /api/admin.
const router = Router();

router.get('/clinics', authenticate as any, requirePlatformAdmin as any, listClinics as any);
router.post('/clinics/:id/send-otp', authenticate as any, requirePlatformAdmin as any, sendOtp as any);
router.post('/clinics/:id/mark-connected', authenticate as any, requirePlatformAdmin as any, markConnected as any);
router.post('/clinics/:id/reset', authenticate as any, requirePlatformAdmin as any, resetConnection as any);

export default router;
