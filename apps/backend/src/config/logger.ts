import winston from 'winston';

const { combine, timestamp, printf, colorize, errors } = winston.format;

const devFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}] ${stack || message}`;
});

const prodFormat = winston.format.json();

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    process.env.NODE_ENV === 'production' ? prodFormat : combine(colorize(), devFormat),
  ),
  transports: [
    new winston.transports.Console(),
    // En production, ajouter un transport fichier ou externe (Datadog, etc.)
  ],
});