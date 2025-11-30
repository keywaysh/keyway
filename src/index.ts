import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import { ZodError } from 'zod';
import { config } from './config';
import { AppError } from './errors';
import { ApiError, ValidationError } from './lib';
import { apiV1Routes } from './api/v1';
import { initAnalytics, shutdownAnalytics, trackEvent, AnalyticsEvents } from './utils/analytics';
import { sql as dbConnection } from './db';
import { sanitizeError, sanitizeHeaders } from './utils/logger';
import { checkCryptoService } from './utils/remoteEncryption';

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
    ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // Inline styles in HTML pages
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'", "https://github.com"],
          upgradeInsecureRequests: [],
        },
      }
    : false, // Disable CSP in development
});

fastify.register(rateLimit, {
  max: 100, // 100 requests
  timeWindow: '15 minutes', // per 15 minutes
  addHeadersOnExceeding: {
    'x-ratelimit-limit': true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset': true,
  },
  addHeaders: {
    'x-ratelimit-limit': true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset': true,
    'retry-after': true,
  },
  errorResponseBuilder: (request, context) => ({
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests, please try again later',
    requestId: request.id,
    retryAfter: context.ttl,
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
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
});

// Register form body parser (for HTML forms)
fastify.register(formbody);

// Register cookie parser
fastify.register(cookie);

// Add request ID to all responses
fastify.addHook('onSend', async (request, reply) => {
  reply.header('X-Request-ID', request.id);
});

// Health check endpoint
fastify.get('/health', async (request, reply) => {
  let dbStatus = 'connected';
  let cryptoStatus = 'connected';
  let cryptoVersion: string | undefined;

  // Check database connectivity
  try {
    await dbConnection`SELECT 1`;
  } catch {
    dbStatus = 'disconnected';
  }

  // Check crypto service connectivity
  try {
    const health = await checkCryptoService(config.crypto.serviceUrl);
    cryptoVersion = health.version;
  } catch {
    cryptoStatus = 'disconnected';
  }

  const isHealthy = dbStatus === 'connected'; // DB is required, crypto is optional for health
  const status = isHealthy ? 'healthy' : 'unhealthy';

  const response = {
    status,
    timestamp: new Date().toISOString(),
    environment: config.server.nodeEnv,
    database: dbStatus,
    crypto: cryptoStatus,
    ...(cryptoVersion && { cryptoVersion }),
  };

  if (!isHealthy) {
    return reply.status(503).send(response);
  }

  return response;
});

// Register API v1 routes
fastify.register(apiV1Routes, { prefix: '/v1' });

// Global error handler
fastify.setErrorHandler((error: Error & { statusCode?: number; validation?: unknown }, request, reply) => {
  // Log error with context - sanitize to prevent token exposure
  fastify.log.error({
    err: sanitizeError(error),
    url: request.url,
    method: request.method,
    reqId: request.id,
    headers: sanitizeHeaders(request.headers),
  }, 'Request error');

  // Track error in analytics (supports both ApiError and AppError)
  const errorCode = error instanceof ApiError
    ? error.type.split('/').pop() || error.name
    : error instanceof AppError
      ? error.code
      : error.name;

  trackEvent(
    (request as any).user?.id || 'anonymous',
    AnalyticsEvents.API_ERROR,
    {
      endpoint: request.url,
      method: request.method,
      errorCode,
      errorType: error.constructor.name,
    }
  );

  // Handle RFC 7807 API errors (primary system)
  if (error instanceof ApiError) {
    return reply.status(error.status).send(error.toProblemDetails(request.id));
  }

  // Handle Zod validation errors - convert to RFC 7807
  if (error instanceof ZodError) {
    const validationError = ValidationError.fromZodError(error);
    return reply.status(400).send(validationError.toProblemDetails(request.id));
  }

  // Handle Fastify validation errors - convert to RFC 7807
  if (error.validation) {
    const validationError = new ValidationError(
      error.message || 'Invalid request data',
      Array.isArray(error.validation)
        ? error.validation.map((v: { instancePath?: string; params?: { missingProperty?: string }; message?: string }) => ({
            field: v.instancePath?.replace(/^\//, '') || v.params?.missingProperty || 'unknown',
            code: 'invalid',
            message: v.message || 'Invalid value',
          }))
        : []
    );
    return reply.status(400).send(validationError.toProblemDetails(request.id));
  }

  // Handle custom application errors (legacy - to be deprecated)
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      ...error.toJSON(),
      requestId: request.id,
    });
  }

  // Handle rate limit errors (from @fastify/rate-limit plugin)
  if (error.statusCode === 429) {
    return reply.status(429).send({
      type: 'https://api.keyway.sh/errors/rate-limited',
      title: 'Too Many Requests',
      status: 429,
      detail: 'Too many requests, please try again later',
      traceId: request.id,
    });
  }

  // Default to 500 Internal Server Error (RFC 7807 format)
  const statusCode = error.statusCode || 500;
  return reply.status(statusCode).send({
    type: 'https://api.keyway.sh/errors/internal-error',
    title: 'Internal Server Error',
    status: statusCode,
    detail: config.server.isProduction
      ? 'An unexpected error occurred'
      : error.message,
    traceId: request.id,
  });
});

// Start server
const start = async () => {
  try {
    // Check database connectivity before starting
    fastify.log.info('Checking database connectivity...');
    try {
      await dbConnection`SELECT 1`;
      fastify.log.info('Database connection successful');
    } catch (dbError) {
      fastify.log.error({ err: dbError }, 'Database connection failed');
      process.exit(1);
    }

    // Check crypto service connectivity (warning only, don't crash)
    fastify.log.info(`Checking crypto service connectivity at ${config.crypto.serviceUrl}...`);
    try {
      const health = await checkCryptoService(config.crypto.serviceUrl);
      fastify.log.info({ version: health.version }, 'Crypto service connection successful');
    } catch (cryptoError) {
      fastify.log.warn({ err: cryptoError }, 'Crypto service not available at startup - encryption/decryption will fail until service is accessible');
    }

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
