import { describe, it, expect } from 'vitest';
import {
  parsePagination,
  buildPaginationMeta,
  PAGINATION_DEFAULTS,
} from '../src/lib/pagination';

describe('Pagination Utils', () => {
  describe('parsePagination', () => {
    it('should use default values when no params provided', () => {
      const result = parsePagination({});

      expect(result.limit).toBe(PAGINATION_DEFAULTS.limit);
      expect(result.offset).toBe(PAGINATION_DEFAULTS.offset);
    });

    it('should parse string values to numbers', () => {
      const result = parsePagination({ limit: '10', offset: '20' });

      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
    });

    it('should use number values directly', () => {
      const result = parsePagination({ limit: 15, offset: 30 });

      expect(result.limit).toBe(15);
      expect(result.offset).toBe(30);
    });

    it('should clamp limit to max value', () => {
      expect(() => parsePagination({ limit: 500 })).toThrow();
    });

    it('should reject negative values', () => {
      expect(() => parsePagination({ limit: -1 })).toThrow();
      expect(() => parsePagination({ offset: -1 })).toThrow();
    });

    it('should reject zero limit', () => {
      expect(() => parsePagination({ limit: 0 })).toThrow();
    });

    it('should accept zero offset', () => {
      const result = parsePagination({ offset: 0 });
      expect(result.offset).toBe(0);
    });
  });

  describe('buildPaginationMeta', () => {
    it('should build correct meta with hasMore=true', () => {
      const query = { limit: 10, offset: 0 };
      const meta = buildPaginationMeta(query, 100, 10);

      expect(meta).toEqual({
        total: 100,
        limit: 10,
        offset: 0,
        hasMore: true,
      });
    });

    it('should build correct meta with hasMore=false on last page', () => {
      const query = { limit: 10, offset: 90 };
      const meta = buildPaginationMeta(query, 100, 10);

      expect(meta.hasMore).toBe(false);
    });

    it('should handle partial last page', () => {
      const query = { limit: 10, offset: 95 };
      const meta = buildPaginationMeta(query, 100, 5);

      expect(meta.hasMore).toBe(false);
    });

    it('should handle empty results', () => {
      const query = { limit: 10, offset: 0 };
      const meta = buildPaginationMeta(query, 0, 0);

      expect(meta).toEqual({
        total: 0,
        limit: 10,
        offset: 0,
        hasMore: false,
      });
    });
  });

});
