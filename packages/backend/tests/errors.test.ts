import { describe, it, expect } from 'vitest';
import {
  ApiError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InternalError,
  ServiceUnavailableError,
} from '../src/lib/errors';

describe('API Errors (RFC 7807 Compliance)', () => {
  describe('ApiError base class', () => {
    it('should create error with all properties', () => {
      const error = new ApiError({
        type: 'test-error',
        title: 'Test Error',
        status: 400,
        detail: 'Test detail',
        instance: '/test/path',
        errors: [{ field: 'name', code: 'required', message: 'Name is required' }],
      });

      expect(error.type).toBe('https://api.keyway.sh/errors/test-error');
      expect(error.title).toBe('Test Error');
      expect(error.status).toBe(400);
      expect(error.detail).toBe('Test detail');
      expect(error.instance).toBe('/test/path');
      expect(error.errors).toHaveLength(1);
      expect(error.name).toBe('ApiError');
    });

    it('should extend Error class', () => {
      const error = new ApiError({
        type: 'test',
        title: 'Test',
        status: 400,
      });

      expect(error).toBeInstanceOf(Error);
      expect(error.stack).toBeDefined();
    });

    it('should use detail or title as message', () => {
      const errorWithDetail = new ApiError({
        type: 'test',
        title: 'Test',
        status: 400,
        detail: 'Detailed message',
      });

      const errorWithoutDetail = new ApiError({
        type: 'test',
        title: 'Test Title',
        status: 400,
      });

      expect(errorWithDetail.message).toBe('Detailed message');
      expect(errorWithoutDetail.message).toBe('Test Title');
    });

    it('should convert to ProblemDetails', () => {
      const error = new ApiError({
        type: 'test-error',
        title: 'Test Error',
        status: 400,
        detail: 'Test detail',
      });

      const problem = error.toProblemDetails('trace-123');

      expect(problem).toEqual({
        type: 'https://api.keyway.sh/errors/test-error',
        title: 'Test Error',
        status: 400,
        detail: 'Test detail',
        traceId: 'trace-123',
      });
    });

    it('should only include optional fields when set', () => {
      const error = new ApiError({
        type: 'minimal',
        title: 'Minimal',
        status: 400,
      });

      const problem = error.toProblemDetails();

      expect(problem).toEqual({
        type: 'https://api.keyway.sh/errors/minimal',
        title: 'Minimal',
        status: 400,
      });
      expect(problem.detail).toBeUndefined();
      expect(problem.instance).toBeUndefined();
      expect(problem.traceId).toBeUndefined();
      expect(problem.errors).toBeUndefined();
    });
  });

  describe('BadRequestError', () => {
    it('should have status 400', () => {
      const error = new BadRequestError('Invalid input');

      expect(error.status).toBe(400);
      expect(error.type).toContain('bad-request');
      expect(error.title).toBe('Bad Request');
      expect(error.name).toBe('BadRequestError');
    });

    it('should support field errors', () => {
      const error = new BadRequestError('Validation failed', [
        { field: 'email', code: 'invalid', message: 'Invalid email format' },
      ]);

      expect(error.errors).toHaveLength(1);
    });
  });

  describe('ValidationError', () => {
    it('should have status 400', () => {
      const error = new ValidationError('Invalid data', [
        { field: 'name', code: 'required', message: 'Name is required' },
      ]);

      expect(error.status).toBe(400);
      expect(error.type).toContain('validation-error');
      expect(error.name).toBe('ValidationError');
    });

    it('should create from Zod error', () => {
      const zodError = {
        errors: [
          { path: ['email'], message: 'Invalid email' },
          { path: ['user', 'name'], message: 'Name too short' },
        ],
      };

      const error = ValidationError.fromZodError(zodError);

      expect(error.errors).toHaveLength(2);
      expect(error.errors![0].field).toBe('email');
      expect(error.errors![1].field).toBe('user.name');
    });
  });

  describe('UnauthorizedError', () => {
    it('should have status 401', () => {
      const error = new UnauthorizedError();

      expect(error.status).toBe(401);
      expect(error.type).toContain('unauthorized');
      expect(error.title).toBe('Unauthorized');
      expect(error.name).toBe('UnauthorizedError');
    });

    it('should use default message', () => {
      const error = new UnauthorizedError();
      expect(error.detail).toBe('Authentication required');
    });

    it('should accept custom message', () => {
      const error = new UnauthorizedError('Token expired');
      expect(error.detail).toBe('Token expired');
    });
  });

  describe('ForbiddenError', () => {
    it('should have status 403', () => {
      const error = new ForbiddenError();

      expect(error.status).toBe(403);
      expect(error.type).toContain('forbidden');
      expect(error.title).toBe('Forbidden');
      expect(error.name).toBe('ForbiddenError');
    });
  });

  describe('NotFoundError', () => {
    it('should have status 404', () => {
      const error = new NotFoundError();

      expect(error.status).toBe(404);
      expect(error.type).toContain('not-found');
      expect(error.title).toBe('Not Found');
      expect(error.name).toBe('NotFoundError');
    });

    it('should accept resource description', () => {
      const error = new NotFoundError('Vault not found');
      expect(error.detail).toBe('Vault not found');
    });
  });

  describe('ConflictError', () => {
    it('should have status 409', () => {
      const error = new ConflictError();

      expect(error.status).toBe(409);
      expect(error.type).toContain('conflict');
      expect(error.title).toBe('Conflict');
      expect(error.name).toBe('ConflictError');
    });
  });

  describe('RateLimitError', () => {
    it('should have status 429', () => {
      const error = new RateLimitError();

      expect(error.status).toBe(429);
      expect(error.type).toContain('rate-limited');
      expect(error.title).toBe('Too Many Requests');
      expect(error.name).toBe('RateLimitError');
    });

    it('should support retryAfter', () => {
      const error = new RateLimitError('Rate limited', 60);

      expect(error.retryAfter).toBe(60);
    });
  });

  describe('InternalError', () => {
    it('should have status 500', () => {
      const error = new InternalError();

      expect(error.status).toBe(500);
      expect(error.type).toContain('internal-error');
      expect(error.title).toBe('Internal Server Error');
      expect(error.name).toBe('InternalError');
    });
  });

  describe('ServiceUnavailableError', () => {
    it('should have status 503', () => {
      const error = new ServiceUnavailableError();

      expect(error.status).toBe(503);
      expect(error.type).toContain('service-unavailable');
      expect(error.title).toBe('Service Unavailable');
      expect(error.name).toBe('ServiceUnavailableError');
    });
  });

  describe('Error hierarchy', () => {
    it('all errors should extend ApiError', () => {
      expect(new BadRequestError('test')).toBeInstanceOf(ApiError);
      expect(new ValidationError('test', [])).toBeInstanceOf(ApiError);
      expect(new UnauthorizedError()).toBeInstanceOf(ApiError);
      expect(new ForbiddenError()).toBeInstanceOf(ApiError);
      expect(new NotFoundError()).toBeInstanceOf(ApiError);
      expect(new ConflictError()).toBeInstanceOf(ApiError);
      expect(new RateLimitError()).toBeInstanceOf(ApiError);
      expect(new InternalError()).toBeInstanceOf(ApiError);
      expect(new ServiceUnavailableError()).toBeInstanceOf(ApiError);
    });

    it('all errors should be catchable as Error', () => {
      const errors = [
        new BadRequestError('test'),
        new UnauthorizedError(),
        new ForbiddenError(),
        new NotFoundError(),
        new InternalError(),
      ];

      errors.forEach((error) => {
        expect(error).toBeInstanceOf(Error);
      });
    });
  });

  describe('Security: Information disclosure', () => {
    it('should not expose internal details in production errors', () => {
      const error = new InternalError();
      const problem = error.toProblemDetails();

      // Default message should be generic
      expect(problem.detail).toBe('An unexpected error occurred');
      // Should not include stack trace in problem details
      expect(problem).not.toHaveProperty('stack');
    });

    it('should allow custom messages but not leak stack traces', () => {
      const error = new InternalError('Database connection failed');
      const problem = error.toProblemDetails();

      expect(problem.detail).toBe('Database connection failed');
      expect(JSON.stringify(problem)).not.toContain('at ');
    });
  });
});
