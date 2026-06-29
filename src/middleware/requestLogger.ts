import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger.log(level, `${req.method} ${req.path}`, { status: res.statusCode, ms: Date.now() - start, ip: req.ip });
  });
  next();
}
