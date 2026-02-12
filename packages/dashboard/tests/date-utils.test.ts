import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatRelativeTime, formatLastSynced } from '../lib/date-utils'

describe('date-utils', () => {
  beforeEach(() => {
    // Mock Date.now to return a fixed date
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('formatRelativeTime', () => {
    it('should return "just now" for very recent times', () => {
      const result = formatRelativeTime('2025-01-15T12:00:00Z')
      expect(result).toBe('just now')
    })

    it('should return minutes ago for times within the hour', () => {
      const result = formatRelativeTime('2025-01-15T11:30:00Z')
      expect(result).toBe('30m ago')
    })

    it('should return hours ago for times within a day', () => {
      const result = formatRelativeTime('2025-01-15T06:00:00Z')
      expect(result).toBe('6h ago')
    })

    it('should return days ago for times within threshold', () => {
      const result = formatRelativeTime('2025-01-10T12:00:00Z')
      expect(result).toBe('5d ago')
    })

    it('should return formatted date for times beyond threshold', () => {
      const result = formatRelativeTime('2024-12-01T12:00:00Z')
      expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
    })

    it('should respect custom daysThreshold', () => {
      // 10 days ago with default 30 threshold - should be relative
      const relative = formatRelativeTime('2025-01-05T12:00:00Z')
      expect(relative).toBe('10d ago')

      // 10 days ago with 7 threshold - should be formatted date
      const formatted = formatRelativeTime('2025-01-05T12:00:00Z', { daysThreshold: 7 })
      expect(formatted).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
    })

    it('should use custom dateFormat when provided', () => {
      const result = formatRelativeTime('2024-12-01T12:00:00Z', {
        daysThreshold: 30,
        dateFormat: { month: 'short', day: 'numeric', year: 'numeric' }
      })
      expect(result).toMatch(/Dec 1, 2024/)
    })
  })

  describe('formatLastSynced', () => {
    it('should return "Never synced" for null', () => {
      const result = formatLastSynced(null)
      expect(result).toBe('Never synced')
    })

    it('should return relative time for valid date', () => {
      const result = formatLastSynced('2025-01-15T11:00:00Z')
      expect(result).toBe('1h ago')
    })

    it('should use 7 day threshold', () => {
      // 5 days ago - should be relative
      const recentResult = formatLastSynced('2025-01-10T12:00:00Z')
      expect(recentResult).toBe('5d ago')

      // 10 days ago - should be formatted
      const oldResult = formatLastSynced('2025-01-05T12:00:00Z')
      expect(oldResult).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
    })
  })
})
