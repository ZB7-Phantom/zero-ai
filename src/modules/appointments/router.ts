import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { listAppointments, createAppointment, updateAppointment } from './handlers';

const router = Router();

router.get('/', authenticate as any, listAppointments as any);
router.post('/', authenticate as any, createAppointment as any);
router.patch('/:id', authenticate as any, updateAppointment as any);

export default router;
