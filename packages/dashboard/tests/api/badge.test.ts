import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../../app/badge.svg/route'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('Badge SVG Route', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    mockFetch.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    process.env = originalEnv
  })

  function createRequest(url: string, headers: Record<string, string> = {}): NextRequest {
    return new NextRequest(new URL(url, 'https://keyway.sh'), {
      headers: new Headers(headers),
    })
  }

  describe('SVG Response', () => {
    it('should return valid SVG content', async () => {
      const request = createRequest('https://keyway.sh/badge.svg')
      const response = await GET(request)
      const body = await response.text()

      expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>')
      expect(body).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
      expect(body).toContain('.env by Keyway')
    })

    it('should return status 200', async () => {
      const request = createRequest('https://keyway.sh/badge.svg')
      const response = await GET(request)

      expect(response.status).toBe(200)
    })

    it('should include key icon path', async () => {
      const request = createRequest('https://keyway.sh/badge.svg')
      const response = await GET(request)
      const body = await response.text()

      // Key icon SVG path
      expect(body).toContain('<path d="M7 6a2 2 0 1 0-4 0')
    })

    it('should have correct dimensions', async () => {
      const request = createRequest('https://keyway.sh/badge.svg')
      const response = await GET(request)
      const body = await response.text()

      expect(body).toContain('width="138"')
      expect(body).toContain('height="20"')
    })

    it('should include aria-label for accessibility', async () => {
      const request = createRequest('https://keyway.sh/badge.svg')
      const response = await GET(request)
      const body = await response.text()

      expect(body).toContain('aria-label=".env by Keyway"')
    })
  })

  describe('Response Headers', () => {
    it('should set Content-Type to image/svg+xml', async () => {
      const request = createRequest('https://keyway.sh/badge.svg')
      const response = await GET(request)

      expect(response.headers.get('Content-Type')).toBe('image/svg+xml')
    })

    it('should set Cache-Control with s-maxage for CDN caching', async () => {
      const request = createRequest('https://keyway.sh/badge.svg')
      const response = await GET(request)

      expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=600')
    })

    it('should set Content-Security-Policy for SVG security', async () => {
      const request = createRequest('https://keyway.sh/badge.svg')
      const response = await GET(request)

      const csp = response.headers.get('Content-Security-Policy')
      expect(csp).toContain("default-src 'none'")
      expect(csp).toContain("style-src 'unsafe-inline'")
      expect(csp).toContain("frame-ancestors 'none'")
    })

    it('should set X-Content-Type-Options to nosniff', async () => {
      const request = createRequest('https://keyway.sh/badge.svg')
      const response = await GET(request)

      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    })
  })

  describe('PostHog Analytics', () => {
    it('should send analytics when POSTHOG_SERVER_API_KEY is set', async () => {
      process.env.POSTHOG_SERVER_API_KEY = 'phk_test_key'
      process.env.POSTHOG_HOST = 'https://app.posthog.com'

      const request = createRequest('https://keyway.sh/badge.svg?repo=owner/repo', {
        referer: 'https://github.com/owner/repo',
        'user-agent': 'Mozilla/5.0',
      })

      await GET(request)

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://app.posthog.com/capture/',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      )

      // Verify payload
      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1].body)
      expect(body.api_key).toBe('phk_test_key')
      expect(body.event).toBe('badge_view')
      expect(body.properties.repo).toBe('owner/repo')
      expect(body.properties.referer).toBe('https://github.com/owner/repo')
      expect(body.properties.ua).toBe('Mozilla/5.0')
      expect(body.distinct_id).toBe('owner/repo')
    })

    it('should NOT send analytics when POSTHOG_SERVER_API_KEY is not set', async () => {
      delete process.env.POSTHOG_SERVER_API_KEY

      const request = createRequest('https://keyway.sh/badge.svg')
      await GET(request)

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should use default PostHog host when POSTHOG_HOST is not set', async () => {
      process.env.POSTHOG_SERVER_API_KEY = 'phk_test_key'
      delete process.env.POSTHOG_HOST

      const request = createRequest('https://keyway.sh/badge.svg')
      await GET(request)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://app.posthog.com/capture/',
        expect.anything()
      )
    })

    it('should strip trailing slash from POSTHOG_HOST', async () => {
      process.env.POSTHOG_SERVER_API_KEY = 'phk_test_key'
      process.env.POSTHOG_HOST = 'https://custom.posthog.com/'

      const request = createRequest('https://keyway.sh/badge.svg')
      await GET(request)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.posthog.com/capture/',
        expect.anything()
      )
    })

    it('should not throw if PostHog fetch fails', async () => {
      process.env.POSTHOG_SERVER_API_KEY = 'phk_test_key'
      mockFetch.mockRejectedValue(new Error('Network error'))

      const request = createRequest('https://keyway.sh/badge.svg')
      const response = await GET(request)

      // Should still return valid response even if analytics fails
      expect(response.status).toBe(200)
    })

    it('should include timestamp in analytics payload', async () => {
      process.env.POSTHOG_SERVER_API_KEY = 'phk_test_key'
      const beforeTime = Date.now()

      const request = createRequest('https://keyway.sh/badge.svg')
      await GET(request)

      const afterTime = Date.now()
      const body = JSON.parse(mockFetch.mock.calls[0][1].body)

      expect(body.properties.ts).toBeGreaterThanOrEqual(beforeTime)
      expect(body.properties.ts).toBeLessThanOrEqual(afterTime)
    })

    it('should include path in analytics payload', async () => {
      process.env.POSTHOG_SERVER_API_KEY = 'phk_test_key'

      const request = createRequest('https://keyway.sh/badge.svg?repo=test')
      await GET(request)

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.properties.path).toContain('/badge.svg')
    })
  })

  describe('Query Parameters', () => {
    it('should use repo from query param', async () => {
      process.env.POSTHOG_SERVER_API_KEY = 'phk_test_key'

      const request = createRequest('https://keyway.sh/badge.svg?repo=myorg/myrepo')
      await GET(request)

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.properties.repo).toBe('myorg/myrepo')
      expect(body.distinct_id).toBe('myorg/myrepo')
    })

    it('should default repo to keyway.sh when not provided', async () => {
      process.env.POSTHOG_SERVER_API_KEY = 'phk_test_key'

      const request = createRequest('https://keyway.sh/badge.svg')
      await GET(request)

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.properties.repo).toBe('keyway.sh')
      expect(body.distinct_id).toBe('keyway.sh')
    })

    it('should fallback to default when repo param is empty', async () => {
      process.env.POSTHOG_SERVER_API_KEY = 'phk_test_key'

      const request = createRequest('https://keyway.sh/badge.svg?repo=')
      await GET(request)

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      // Empty string is falsy, so || operator triggers the fallback
      expect(body.properties.repo).toBe('keyway.sh')
      expect(body.distinct_id).toBe('keyway.sh')
    })
  })

  describe('Request Headers Extraction', () => {
    it('should extract referer header', async () => {
      process.env.POSTHOG_SERVER_API_KEY = 'phk_test_key'

      const request = createRequest('https://keyway.sh/badge.svg', {
        referer: 'https://github.com/owner/repo/blob/main/README.md',
      })
      await GET(request)

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.properties.referer).toBe('https://github.com/owner/repo/blob/main/README.md')
    })

    it('should extract user-agent header', async () => {
      process.env.POSTHOG_SERVER_API_KEY = 'phk_test_key'

      const request = createRequest('https://keyway.sh/badge.svg', {
        'user-agent': 'GitHub-Hookshot/abc123',
      })
      await GET(request)

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.properties.ua).toBe('GitHub-Hookshot/abc123')
    })

    it('should handle missing referer header', async () => {
      process.env.POSTHOG_SERVER_API_KEY = 'phk_test_key'

      const request = createRequest('https://keyway.sh/badge.svg')
      await GET(request)

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.properties.referer).toBeNull()
    })

    it('should handle missing user-agent header', async () => {
      process.env.POSTHOG_SERVER_API_KEY = 'phk_test_key'

      const request = createRequest('https://keyway.sh/badge.svg')
      await GET(request)

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.properties.ua).toBeNull()
    })
  })
})
