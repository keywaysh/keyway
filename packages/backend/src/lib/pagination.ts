import { z } from "zod";

/**
 * Default pagination values
 */
export const PAGINATION_DEFAULTS = {
  limit: 20,
  maxLimit: 100,
  offset: 0,
} as const;

/**
 * Pagination query parameters schema
 */
export const PaginationQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION_DEFAULTS.maxLimit)
    .default(PAGINATION_DEFAULTS.limit),
  offset: z.coerce.number().int().min(0).default(PAGINATION_DEFAULTS.offset),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/**
 * Pagination metadata for responses
 */
export interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Parse pagination query params with defaults
 */
export function parsePagination(query: unknown): PaginationQuery {
  return PaginationQuerySchema.parse(query);
}

/**
 * Build pagination metadata from query and total count
 */
export function buildPaginationMeta(
  query: PaginationQuery,
  total: number,
  returnedCount: number
): PaginationMeta {
  return {
    total,
    limit: query.limit,
    offset: query.offset,
    hasMore: query.offset + returnedCount < total,
  };
}
