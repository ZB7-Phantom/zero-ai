import { Router } from 'express';
import { submitDemoRequest } from './controller';

const router = Router();

router.post('/demo-request', submitDemoRequest);

export default router;
