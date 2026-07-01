import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { getDashboardSummary } from './handlers';

const router = Router();

router.get('/dashboard', authenticate as any, getDashboardSummary as any);

export default router;
