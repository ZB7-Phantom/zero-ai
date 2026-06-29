import rateLimit from 'express-rate-limit';
import { logger } from '../config/logger';

const make = (windowMs: number, max: number, message: string, prefix: string) =>
  rateLimit({
    windowMs, max,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { ip: false },
    keyGenerator: (req) => {
      const ip = (req.ip || req.socket.remoteAddress || 'unknown')
        .replace(/^::ffff:/, ''); // strip IPv6-mapped IPv4 prefix
      return `${prefix}:${ip}`;
    },
    handler: (req, res) => {
      logger.warn('Rate limit hit', { ip: req.ip, path: req.path });
      res.status(429).json({ error: message, code: 'RATE_LIMITED' });
    },
  });

export const globalLimiter  = make(15 * 60 * 1000, 500,  'Too many requests',                     'rl:global');
export const authLimiter    = make(15 * 60 * 1000, 10,   'Too many login attempts, wait 15 min',   'rl:auth');
export const webhookLimiter = make(60 * 1000,       1000, 'Webhook rate limit exceeded',            'rl:webhook');
