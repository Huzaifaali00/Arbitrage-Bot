import winston from 'winston';
import path from 'path';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json(),
    winston.format.printf(({ timestamp, level, message, ...rest }) => {
      const sanitized = Object.fromEntries(
        Object.entries(rest).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])
      );
      const meta = Object.keys(sanitized).length ? JSON.stringify(sanitized) : '';
      return `${timestamp} [${level.toUpperCase()}]: ${message} ${meta}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...rest }) => {
          const sanitized = Object.fromEntries(
            Object.entries(rest).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])
          );
          const meta = Object.keys(sanitized).length ? ` ${JSON.stringify(sanitized)}` : '';
          return `${timestamp} ${level}: ${message}${meta}`;
        })
      ),
    }),
    new winston.transports.File({
      filename: path.join('logs', 'bot.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error',
      maxsize: 10485760,
      maxFiles: 5,
    }),
  ],
});

export default logger;
