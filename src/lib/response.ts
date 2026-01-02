import type { FastifyReply } from "fastify";
import type { PaginationMeta } from "./pagination";

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T> {
  data: T;
  meta?: ResponseMeta;
}

export interface ResponseMeta {
  requestId?: string;
  pagination?: PaginationMeta;
}

/**
 * Response helper for single resource
 */
export function sendData<T>(
  reply: FastifyReply,
  data: T,
  options?: {
    status?: number;
    requestId?: string;
  }
): FastifyReply {
  const response: ApiResponse<T> = { data };

  if (options?.requestId) {
    response.meta = { requestId: options.requestId };
  }

  return reply.status(options?.status ?? 200).send(response);
}

/**
 * Response helper for paginated collection
 */
export function sendPaginatedData<T>(
  reply: FastifyReply,
  data: T[],
  pagination: PaginationMeta,
  options?: {
    status?: number;
    requestId?: string;
  }
): FastifyReply {
  const response: ApiResponse<T[]> = {
    data,
    meta: {
      pagination,
      ...(options?.requestId && { requestId: options.requestId }),
    },
  };

  return reply.status(options?.status ?? 200).send(response);
}

/**
 * Response helper for created resource (201)
 */
export function sendCreated<T>(
  reply: FastifyReply,
  data: T,
  options?: {
    location?: string;
    requestId?: string;
  }
): FastifyReply {
  if (options?.location) {
    reply.header("Location", options.location);
  }

  const response: ApiResponse<T> = { data };

  if (options?.requestId) {
    response.meta = { requestId: options.requestId };
  }

  return reply.status(201).send(response);
}

/**
 * Response helper for no content (204)
 */
export function sendNoContent(reply: FastifyReply): FastifyReply {
  return reply.status(204).send();
}
