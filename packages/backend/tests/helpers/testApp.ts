import Fastify, { FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import { ApiError, ValidationError } from '../../src/lib/errors';

/**
 * Create a test Fastify instance
 * This creates a minimal app for testing routes with RFC 7807 error handling
 */
export async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
  });

  // Register form body parser (needed for POST routes)
  await app.register(formbody);

  // Configure RFC 7807 error handler (same as production)
  app.setErrorHandler((error: Error & { statusCode?: number; validation?: unknown }, request, reply) => {
    // Handle RFC 7807 API errors
    if (error instanceof ApiError) {
      return reply.status(error.status).send(error.toProblemDetails(request.id));
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

    // Handle rate limit errors
    if (error.statusCode === 429) {
      return reply.status(429).send({
        type: 'https://api.keyway.sh/errors/rate-limited',
        title: 'Too Many Requests',
        status: 429,
        detail: 'Too many requests, please try again later',
        traceId: request.id,
      });
    }

    // Generic error fallback
    return reply.status(error.statusCode || 500).send({
      type: 'https://api.keyway.sh/errors/internal-error',
      title: 'Internal Server Error',
      status: error.statusCode || 500,
      detail: error.message || 'An unexpected error occurred',
      traceId: request.id,
    });
  });

  return app;
}

/**
 * Close the test app
 */
export async function closeTestApp(app: FastifyInstance): Promise<void> {
  await app.close();
}
