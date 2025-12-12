import pino from 'pino';
import { config } from '../config';

/**
 * Shared logger for use in utilities and services where Fastify request context isn't available.
 *
 * Usage guidelines:
 * - In route handlers: Use `request.log.*` (includes request ID automatically)
 * - In services/utils: Use this `logger` for operations without request context
 * - Always use structured logging: `logger.info({ key: value }, 'Message')`
 * - Sanitize tokens/secrets using helpers from `utils/logger`
 *
 * Log levels:
 * - error: Unexpected errors that need investigation
 * - warn: Expected issues (e.g., rate limits, auth failures)
 * - info: Significant events (e.g., sync completed, user created)
 * - debug: Detailed debugging info (disabled in production)
 */

// Safe defaults for when config is not fully loaded (e.g., during tests)
const logLevel = config?.server?.logLevel ?? 'info';
const isDevelopment = config?.server?.isDevelopment ?? false;

export const logger = pino({
  level: logLevel,
  // Use pino-pretty in development for readable output
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});
