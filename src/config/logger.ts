import winston from 'winston';
import { env } from './env';

const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) =>
    `${timestamp} [${level}] ${message}${Object.keys(meta).length ? ' ' + JSON.stringify(meta) : ''}`
  )
);

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'development' ? 'debug' : 'info',
  format: env.NODE_ENV === 'development' ? devFormat : winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
  exceptionHandlers: [new winston.transports.Console()],
  rejectionHandlers: [new winston.transports.Console()],
});
