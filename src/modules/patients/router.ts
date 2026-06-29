import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { listPatients, getPatient, createPatient } from './handlers';

const router = Router();

router.get('/', authenticate as any, listPatients as any);
router.get('/:id', authenticate as any, getPatient as any);
router.post('/', authenticate as any, createPatient as any);

export default router;
