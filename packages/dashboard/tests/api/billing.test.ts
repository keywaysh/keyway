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
            plan: 'team',
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
      expect(result.plan).toBe('team')
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
              team: {
                monthly: { id: 'price_team_monthly', price: 999, currency: 'eur', interval: 'month' },
                yearly: { id: 'price_team_yearly', price: 9999, currency: 'eur', interval: 'year' },
              },
              business: {
                monthly: { id: 'price_business_monthly', price: 1999, currency: 'eur', interval: 'month' },
                yearly: { id: 'price_business_yearly', price: 19999, currency: 'eur', interval: 'year' },
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
      expect(result.prices.team?.monthly?.interval).toBe('month')
      expect(result.prices.team?.yearly?.interval).toBe('year')
      expect(result.prices.business?.monthly?.currency).toBe('eur')
      // The pro tier is retired: the API only serves team and business
      expect('pro' in result.prices).toBe(false)
    })

    it('should surface null interval slots when Stripe lacks a price', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            prices: {
              team: { monthly: null, yearly: null },
              business: { monthly: null, yearly: null },
            },
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await billingApi.getPrices()

      expect(result.prices.team?.monthly).toBeNull()
      expect(result.prices.business?.yearly).toBeNull()
    })
  })

  describe('createCheckoutSession', () => {
    it('should create a personal checkout session', async () => {
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
