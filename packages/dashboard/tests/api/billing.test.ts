import { describe, it, expect, vi, beforeEach } from 'vitest'
import { billingApi } from '../../lib/api/billing'

const mockFetch = vi.fn()
global.fetch = mockFetch

describe('billingApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getSubscription', () => {
    it('should fetch user subscription', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            subscription: {
              id: 'sub_123',
              status: 'active',
              currentPeriodEnd: '2025-12-31T00:00:00Z',
              cancelAtPeriodEnd: false,
            },
            plan: 'pro',
            billingStatus: 'active',
            stripeCustomerId: 'cus_123',
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await billingApi.getSubscription()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/billing/subscription'),
        expect.any(Object)
      )
      expect(result.plan).toBe('pro')
      expect(result.billingStatus).toBe('active')
      expect(result.subscription?.status).toBe('active')
    })

    it('should handle free plan with no subscription', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            subscription: null,
            plan: 'free',
            billingStatus: 'active',
            stripeCustomerId: null,
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await billingApi.getSubscription()

      expect(result.plan).toBe('free')
      expect(result.subscription).toBeNull()
    })
  })

  describe('getPrices', () => {
    it('should fetch available prices', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            prices: {
              pro: {
                monthly: { id: 'price_monthly', price: 999, interval: 'month' },
                yearly: { id: 'price_yearly', price: 9999, interval: 'year' },
              },
            },
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await billingApi.getPrices()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/billing/prices'),
        expect.any(Object)
      )
      expect(result.prices.pro.monthly.interval).toBe('month')
      expect(result.prices.pro.yearly.interval).toBe('year')
    })
  })

  describe('createCheckoutSession', () => {
    it('should create checkout session', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: { url: 'https://checkout.stripe.com/session/123' },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await billingApi.createCheckoutSession(
        'price_1',
        'https://keyway.sh/success',
        'https://keyway.sh/cancel'
      )

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/billing/create-checkout-session'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            priceId: 'price_1',
            successUrl: 'https://keyway.sh/success',
            cancelUrl: 'https://keyway.sh/cancel',
          }),
        })
      )
      expect(result.url).toContain('stripe.com')
    })
  })

  describe('createPortalSession', () => {
    it('should create billing portal session', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: { url: 'https://billing.stripe.com/portal/123' },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await billingApi.createPortalSession('https://keyway.sh/billing')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/billing/manage'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ returnUrl: 'https://keyway.sh/billing' }),
        })
      )
      expect(result.url).toContain('stripe.com')
    })
  })
})
