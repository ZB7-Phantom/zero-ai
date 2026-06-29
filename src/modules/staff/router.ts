import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import { listStaff, addStaff, removeStaff } from './handlers';

const router = Router();

// All staff routes require auth. Add/remove require ADMIN role.
router.get('/', authenticate as any, listStaff as any);
router.post('/', authenticate as any, requireRole('ADMIN') as any, addStaff as any);
router.delete('/:id', authenticate as any, requireRole('ADMIN') as any, removeStaff as any);

export default router;
