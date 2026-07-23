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
import adminRouter from './modules/admin/router';
import { startSchedulers } from './services/scheduler';
const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// Allow the configured frontend plus any extra origins (e.g. local dev servers).
// In non-production, common Vite/CRA localhost ports are allowed automatically
// so the frontend can be developed against the deployed backend.
const allowedOrigins = new Set([
  env.FRONTEND_URL,
  ...(env.FRONTEND_URLS_EXTRA?.split(',').map((o) => o.trim()).filter(Boolean) ?? []),
  ...(env.NODE_ENV !== 'production'
    ? ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000']
    : []),
]);

const corsOptions = {
  origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    // Passing `false` (not an Error) tells the cors middleware to just omit
    // the CORS headers — the browser blocks the response client-side. An
    // Error here would propagate to the error handler as a 500, which is
    // misleading for what's actually just a disallowed cross-origin request.
    callback(null, !origin || allowedOrigins.has(origin));
  },
  credentials: true,
  // Non-safelisted response headers are hidden from cross-origin fetch() JS
  // unless explicitly exposed. The frontend reads these to show a precise
  // "try again in X" message when the auth rate limiter returns 429.
  exposedHeaders: ['Retry-After', 'RateLimit-Reset', 'RateLimit-Limit', 'RateLimit-Remaining'],
};

// Socket.io — each clinic joins a room by clinicId so events never cross tenants
export const io = new SocketIOServer(server, {
  cors: { origin: [...allowedOrigins], methods: ['GET', 'POST'] },
});

io.on('connection', (socket) => {
  socket.on('join:clinic', (clinicId: string) => socket.join(`clinic:${clinicId}`));
});

app.use(helmet());
app.use(cors(corsOptions));
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
app.use('/api/admin', adminRouter);
app.use('/webhook', webhookRouter);

app.use(errorHandler); // Must be last

async function start() {
  await prisma.$connect();
  logger.info('Database connected');

  // Bind port first so Railway health check succeeds immediately
  await new Promise<void>((resolve) => {
    server.listen(parseInt(env.PORT), () => {
      logger.info(`Zero API on port ${env.PORT}`);
      resolve();
    });
  });

  // Schedulers — in-process cron, no Redis dependency
  startSchedulers();
}

process.on('SIGTERM', async () => { await prisma.$disconnect(); process.exit(0); });
process.on('SIGINT',  async () => { await prisma.$disconnect(); process.exit(0); });

start().catch((err) => { logger.error(`Startup failed: ${(err as Error).message}`); process.exit(1); });

export { app, server };
