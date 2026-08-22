import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger';

export class AppError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
    this.name = 'AppError';
  }
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  // Use console.error directly to ensure the raw stack trace is never dropped or 
  // swallowed by Winston's JSON stringifier or formatters.
  console.error('\n--- UNHANDLED ERROR FATAL TRACE ---');
  console.error(`Path: ${req.method} ${req.path}`);
  console.error(err);
  console.error('-----------------------------------\n');
  
  logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path, method: req.method });

  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: err.flatten().fieldErrors });
    return;
  }
  
  // Fallback property check in case of circular dependency or TS prototype stripping
  if (err instanceof AppError || ('statusCode' in err && 'code' in err)) {
    const status = (err as any).statusCode || 400;
    res.status(status).json({ error: err.message, code: (err as any).code });
    return;
  }
  
  res.status(500).json({ error: 'An unexpected error occurred', code: 'INTERNAL_ERROR' });
}
