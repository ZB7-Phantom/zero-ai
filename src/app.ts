import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { Server as SocketIOServer } from 'socket.io';
import { env } from './config/env';
import { prisma } from './config/database';
import { logger } from './config/logger';
import { requestLogger } from './middleware/requestLogger';
import { globalLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import authRouter from './modules/auth/router';
import clinicRouter from './modules/clinic/router';
import staffRouter from './modules/staff/router';
import webhookRouter from './modules/webhook/router';
import queueRouter from './modules/queue/router';
import patientsRouter from './modules/patients/router';
import appointmentsRouter from './modules/appointments/router';
import conversationsRouter from './modules/conversations/router';
import notificationsRouter from './modules/notifications/router';
import analyticsRouter from './modules/analytics/router';
import { scheduleMidnightReset } from './services/scheduler/queueReset';
import { scheduleReminders } from './services/scheduler/appointmentReminders';
import { scheduleNoShowDetector } from './services/scheduler/noShowDetector';
const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// Socket.io — each clinic joins a room by clinicId so events never cross tenants
export const io = new SocketIOServer(server, {
  cors: { origin: env.FRONTEND_URL, methods: ['GET', 'POST'] },
});

io.on('connection', (socket) => {
  socket.on('join:clinic', (clinicId: string) => socket.join(`clinic:${clinicId}`));
});

app.use(helmet());
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(compression());

// Raw body preserved on every request — Meta webhook HMAC verification requires it
app.use(express.json({
  verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use(globalLimiter);

app.get('/', (_req, res) => {
  res.json({ status: 'Zero API running', version: '1.0.0', env: env.NODE_ENV });
});

app.use('/api/auth', authRouter);
app.use('/api/clinic', clinicRouter);
app.use('/api/staff', staffRouter);
app.use('/api/queue', queueRouter);
app.use('/api/patients', patientsRouter);
app.use('/api/appointments', appointmentsRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/webhook', webhookRouter);

app.use(errorHandler); // Must be last

async function start() {
  await prisma.$connect();
  logger.info('Database connected');
  await scheduleMidnightReset();
  await scheduleReminders();
  await scheduleNoShowDetector();
  logger.info('Scheduler ready');
  server.listen(parseInt(env.PORT), () => logger.info(`Zero API on port ${env.PORT}`));
}

process.on('SIGTERM', async () => { await prisma.$disconnect(); process.exit(0); });
process.on('SIGINT',  async () => { await prisma.$disconnect(); process.exit(0); });

start().catch((err) => { logger.error('Startup failed', { err }); process.exit(1); });

export { app, server };
