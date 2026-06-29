import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger';

export class AppError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message);
  }
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  logger.error('Unhandled error', { error: err.message, path: req.path, method: req.method });

  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: err.flatten().fieldErrors });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message, code: err.code });
    return;
  }
  res.status(500).json({ error: 'An unexpected error occurred', code: 'INTERNAL_ERROR' });
}
