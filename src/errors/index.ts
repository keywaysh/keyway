/**
 * Base error class for all application errors
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      ...(this.details && { details: this.details }),
    };
  }
}

/**
 * 400 - Validation Error
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

/**
 * 401 - Unauthorized
 */
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

/**
 * 403 - Forbidden
 */
export class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}

/**
 * 404 - Not Found
 */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
  }
}

/**
 * 409 - Conflict
 */
export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(409, 'CONFLICT', message);
  }
}

/**
 * 429 - Too Many Requests
 */
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(429, 'RATE_LIMIT_EXCEEDED', message);
  }
}

/**
 * 500 - Internal Server Error
 */
export class InternalServerError extends AppError {
  constructor(message = 'An unexpected error occurred') {
    super(500, 'INTERNAL_SERVER_ERROR', message);
  }
}

/**
 * 503 - Service Unavailable
 */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(503, 'SERVICE_UNAVAILABLE', message);
  }
}
