import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config } from './config';
import { AppError } from './errors';
import { authRoutes } from './routes/auth';
import { vaultRoutes } from './routes/vaults';
import { initAnalytics, shutdownAnalytics, trackEvent, AnalyticsEvents } from './utils/analytics';
import { sql as dbConnection } from './db';

// Create Fastify instance
const fastify = Fastify({
  logger: {
    level: config.server.logLevel,
  },
  requestIdHeader: 'x-request-id',
  requestIdLogLabel: 'reqId',
});

// Register security plugins
fastify.register(helmet, {
  contentSecurityPolicy: config.server.isProduction
    ? undefined
    : false, // Disable CSP in development
});

fastify.register(rateLimit, {
  max: 100, // 100 requests
  timeWindow: '15 minutes', // per 15 minutes
  errorResponseBuilder: () => ({
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests, please try again later',
  }),
});

// Register CORS
fastify.register(cors, {
  origin: config.cors.allowAll
    ? true // Allow all in development
    : config.cors.allowedOrigins.length > 0
    ? config.cors.allowedOrigins
    : false, // Block all if no origins specified in production
  credentials: true,
});

// Health check endpoint
fastify.get('/health', async (request, reply) => {
  try {
    // Check database connectivity
    await dbConnection`SELECT 1`;

    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: config.server.nodeEnv,
      database: 'connected',
    };
  } catch (error) {
    fastify.log.error({ err: error }, 'Health check failed');

    return reply.status(503).send({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      environment: config.server.nodeEnv,
      database: 'disconnected',
    });
  }
});

// Register routes
fastify.register(authRoutes, { prefix: '/auth' });
fastify.register(vaultRoutes, { prefix: '/vaults' });

// Global error handler
fastify.setErrorHandler((error: Error & { statusCode?: number; validation?: unknown }, request, reply) => {
  // Log error with context
  fastify.log.error({
    err: error,
    url: request.url,
    method: request.method,
    reqId: request.id,
  }, 'Request error');

  // Track error in analytics
  trackEvent(
    (request as any).user?.id || 'anonymous',
    AnalyticsEvents.API_ERROR,
    {
      endpoint: request.url,
      method: request.method,
      errorCode: error instanceof AppError ? error.code : error.name,
      errorType: error.constructor.name,
    }
  );

  // Handle custom application errors
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      details: error.errors,
    });
  }

  // Handle Fastify validation errors
  if (error.validation) {
    return reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: error.message,
      details: error.validation,
    });
  }

  // Handle rate limit errors
  if (error.statusCode === 429) {
    return reply.status(429).send({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
    });
  }

  // Default to 500 Internal Server Error
  const statusCode = error.statusCode || 500;
  return reply.status(statusCode).send({
    error: 'INTERNAL_SERVER_ERROR',
    message: config.server.isProduction
      ? 'An unexpected error occurred'
      : error.message,
  });
});

// Start server
const start = async () => {
  try {
    // Initialize analytics
    initAnalytics();

    // Start server
    await fastify.listen({
      port: config.server.port,
      host: config.server.host,
    });

    fastify.log.info(`
╔═══════════════════════════════════════╗
║                                       ║
║   🔐 Keyway API Server                ║
║                                       ║
║   Server running on: ${config.server.host}:${config.server.port}     ║
║   Environment: ${config.server.nodeEnv}            ║
║                                       ║
╚═══════════════════════════════════════╝
    `);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  fastify.log.info('Shutting down gracefully...');

  await shutdownAnalytics();
  await fastify.close();

  fastify.log.info('Server shut down successfully');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
