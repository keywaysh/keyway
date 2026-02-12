/**
 * RFC 7807 Problem Details for HTTP APIs
 * https://datatracker.ietf.org/doc/html/rfc7807
 */

import { config } from "../config";

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  traceId?: string;
  errors?: FieldError[];
}

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

const ERROR_BASE_URL = config.errors?.baseUrl || "https://api.keyway.sh/errors";

/**
 * Base class for RFC 7807 compliant errors
 */
export class ApiError extends Error {
  public readonly type: string;
  public readonly title: string;
  public readonly status: number;
  public readonly detail?: string;
  public readonly instance?: string;
  public readonly errors?: FieldError[];

  constructor(options: {
    type: string;
    title: string;
    status: number;
    detail?: string;
    instance?: string;
    errors?: FieldError[];
  }) {
    super(options.detail || options.title);
    this.type = `${ERROR_BASE_URL}/${options.type}`;
    this.title = options.title;
    this.status = options.status;
    this.detail = options.detail;
    this.instance = options.instance;
    this.errors = options.errors;
    this.name = "ApiError";
    Error.captureStackTrace(this, this.constructor);
  }

  toProblemDetails(traceId?: string): ProblemDetails {
    const problem: ProblemDetails = {
      type: this.type,
      title: this.title,
      status: this.status,
    };

    if (this.detail) {
      problem.detail = this.detail;
    }
    if (this.instance) {
      problem.instance = this.instance;
    }
    if (traceId) {
      problem.traceId = traceId;
    }
    if (this.errors?.length) {
      problem.errors = this.errors;
    }

    return problem;
  }
}

/**
 * 400 - Bad Request / Validation Error
 */
export class BadRequestError extends ApiError {
  constructor(detail: string, errors?: FieldError[]) {
    super({
      type: "bad-request",
      title: "Bad Request",
      status: 400,
      detail,
      errors,
    });
    this.name = "BadRequestError";
  }
}

/**
 * 400 - Validation Error (with field-level errors)
 */
export class ValidationError extends ApiError {
  constructor(detail: string, errors: FieldError[]) {
    super({
      type: "validation-error",
      title: "Validation Error",
      status: 400,
      detail,
      errors,
    });
    this.name = "ValidationError";
  }

  static fromZodError(zodError: {
    errors: Array<{ path: (string | number)[]; message: string }>;
  }): ValidationError {
    const errors: FieldError[] = zodError.errors.map((e) => ({
      field: e.path.join("."),
      code: "invalid",
      message: e.message,
    }));
    return new ValidationError("Invalid request data", errors);
  }
}

/**
 * 401 - Unauthorized
 */
export class UnauthorizedError extends ApiError {
  constructor(detail = "Authentication required") {
    super({
      type: "unauthorized",
      title: "Unauthorized",
      status: 401,
      detail,
    });
    this.name = "UnauthorizedError";
  }
}

/**
 * 403 - Forbidden
 */
export class ForbiddenError extends ApiError {
  constructor(detail = "You do not have permission to access this resource") {
    super({
      type: "forbidden",
      title: "Forbidden",
      status: 403,
      detail,
    });
    this.name = "ForbiddenError";
  }
}

/**
 * 404 - Not Found
 */
export class NotFoundError extends ApiError {
  constructor(detail = "The requested resource was not found") {
    super({
      type: "not-found",
      title: "Not Found",
      status: 404,
      detail,
    });
    this.name = "NotFoundError";
  }
}

/**
 * 409 - Conflict
 */
export class ConflictError extends ApiError {
  constructor(detail = "The resource already exists") {
    super({
      type: "conflict",
      title: "Conflict",
      status: 409,
      detail,
    });
    this.name = "ConflictError";
  }
}

/**
 * 429 - Rate Limited
 */
export class RateLimitError extends ApiError {
  public readonly retryAfter?: number;

  constructor(detail = "Too many requests, please try again later", retryAfter?: number) {
    super({
      type: "rate-limited",
      title: "Too Many Requests",
      status: 429,
      detail,
    });
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

/**
 * 500 - Internal Server Error
 */
export class InternalError extends ApiError {
  constructor(detail = "An unexpected error occurred") {
    super({
      type: "internal-error",
      title: "Internal Server Error",
      status: 500,
      detail,
    });
    this.name = "InternalError";
  }
}

/**
 * 503 - Service Unavailable
 */
export class ServiceUnavailableError extends ApiError {
  constructor(detail = "Service temporarily unavailable") {
    super({
      type: "service-unavailable",
      title: "Service Unavailable",
      status: 503,
      detail,
    });
    this.name = "ServiceUnavailableError";
  }
}

/**
 * Trial eligibility info included in plan limit errors
 */
export interface TrialEligibilityInfo {
  eligible: boolean;
  daysAvailable: number;
  orgLogin: string;
  reason?: string;
}

/**
 * 403 - Plan Limit Reached
 * Special error for when a user exceeds their plan limits
 * Includes trial eligibility info for org repos to enable CLI trial prompts
 */
export class PlanLimitError extends ApiError {
  public readonly upgradeUrl: string;
  public readonly trialInfo?: TrialEligibilityInfo;

  constructor(
    detail: string,
    upgradeUrl = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/upgrade`
      : "https://keyway.sh/upgrade",
    trialInfo?: TrialEligibilityInfo
  ) {
    super({
      type: "plan-limit-reached",
      title: "Plan Limit Reached",
      status: 403,
      detail,
    });
    this.name = "PlanLimitError";
    this.upgradeUrl = upgradeUrl;
    this.trialInfo = trialInfo;
  }

  toProblemDetails(
    traceId?: string
  ): ProblemDetails & { upgradeUrl: string; trialInfo?: TrialEligibilityInfo } {
    const details: ProblemDetails & { upgradeUrl: string; trialInfo?: TrialEligibilityInfo } = {
      ...super.toProblemDetails(traceId),
      upgradeUrl: this.upgradeUrl,
    };

    if (this.trialInfo) {
      details.trialInfo = this.trialInfo;
    }

    return details;
  }
}
