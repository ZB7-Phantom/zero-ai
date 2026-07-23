import { Router } from 'express';
import { authenticate, requirePlatformAdmin } from '../../middleware/auth';
import {
  overview, listAllClinics, getClinicDetail, suspendClinic, reactivateClinic,
  billing, changePlan, listAudit, listStaff, deactivateStaff, activateStaff,
  whatsappPipeline, sendOtp, markConnected, resetConnection,
} from './handlers';

// Internal Zero-team routes. Every route requires a valid session AND that the
// caller's email is in PLATFORM_ADMIN_EMAILS — a clinic's own ADMIN role is not
// enough. Mounted at /api/admin.
const router = Router();
const guard = [authenticate as any, requirePlatformAdmin as any];

// Console
router.get('/overview', ...guard, overview as any);
router.get('/clinics', ...guard, listAllClinics as any);
router.get('/clinics/:id', ...guard, getClinicDetail as any);
router.post('/clinics/:id/suspend', ...guard, suspendClinic as any);
router.post('/clinics/:id/reactivate', ...guard, reactivateClinic as any);

// Billing
router.get('/billing', ...guard, billing as any);
router.post('/clinics/:id/plan', ...guard, changePlan as any);

// Audit log
router.get('/audit', ...guard, listAudit as any);

// Staff lookup
router.get('/staff', ...guard, listStaff as any);
router.post('/staff/:id/deactivate', ...guard, deactivateStaff as any);
router.post('/staff/:id/activate', ...guard, activateStaff as any);

// WhatsApp connection pipeline
router.get('/whatsapp-pipeline', ...guard, whatsappPipeline as any);
router.post('/clinics/:id/send-otp', ...guard, sendOtp as any);
router.post('/clinics/:id/mark-connected', ...guard, markConnected as any);
router.post('/clinics/:id/reset', ...guard, resetConnection as any);

export default router;
