import { describe, it, expect, vi, beforeEach } from 'vitest'
import { orgBillingApi } from '../../lib/api/org-billing'

const mockFetch = vi.fn()
global.fetch = mockFetch

describe('orgBillingApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getOrganizationBilling', () => {
    it('should fetch organization billing status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            plan: 'team',
            effectivePlan: 'team',
            billingStatus: 'active',
            stripeCustomerId: 'cus_123',
            subscription: {
              id: 'sub_123',
              status: 'active',
              currentPeriodEnd: '2025-12-31T00:00:00Z',
              cancelAtPeriodEnd: false,
            },
            trial: {
              status: 'none',
              startedAt: null,
              endsAt: null,
              convertedAt: null,
              daysRemaining: null,
              trialDurationDays: 15,
            },
            prices: {
              monthly: { id: 'price_monthly', price: 999, interval: 'month' },
              yearly: { id: 'price_yearly', price: 9999, interval: 'year' },
            },
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await orgBillingApi.getOrganizationBilling('acme')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/orgs/acme/billing'),
        expect.any(Object)
      )
      expect(result.plan).toBe('team')
      expect(result.effective_plan).toBe('team')
      expect(result.billing_status).toBe('active')
      expect(result.subscription?.status).toBe('active')
      expect(result.trial.status).toBe('none')
    })

    it('should handle free plan without subscription', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            plan: 'free',
            effectivePlan: 'free',
            billingStatus: null,
            stripeCustomerId: null,
            subscription: null,
            trial: {
              status: 'none',
              startedAt: null,
              endsAt: null,
              convertedAt: null,
              daysRemaining: null,
              trialDurationDays: 15,
            },
            prices: null,
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await orgBillingApi.getOrganizationBilling('acme')

      expect(result.plan).toBe('free')
      expect(result.subscription).toBeNull()
      expect(result.stripe_customer_id).toBeNull()
    })

    it('should handle active trial', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            plan: 'free',
            effectivePlan: 'team',
            billingStatus: 'trialing',
            stripeCustomerId: null,
            subscription: null,
            trial: {
              status: 'active',
              startedAt: '2025-01-01T00:00:00Z',
              endsAt: '2025-01-16T00:00:00Z',
              convertedAt: null,
              daysRemaining: 10,
              trialDurationDays: 15,
            },
            prices: {
              monthly: { id: 'price_monthly', price: 999, interval: 'month' },
              yearly: { id: 'price_yearly', price: 9999, interval: 'year' },
            },
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await orgBillingApi.getOrganizationBilling('acme')

      expect(result.plan).toBe('free')
      expect(result.effective_plan).toBe('team')
      expect(result.trial.status).toBe('active')
      expect(result.trial.days_remaining).toBe(10)
    })
  })

  describe('createOrganizationCheckoutSession', () => {
    it('should create checkout session', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: { url: 'https://checkout.stripe.com/session/123' },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await orgBillingApi.createOrganizationCheckoutSession(
        'acme',
        'price_1',
        'https://keyway.sh/success',
        'https://keyway.sh/cancel'
      )

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/orgs/acme/billing/checkout'),
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

  describe('createOrganizationPortalSession', () => {
    it('should create billing portal session', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: { url: 'https://billing.stripe.com/portal/123' },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await orgBillingApi.createOrganizationPortalSession(
        'acme',
        'https://keyway.sh/billing'
      )

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/orgs/acme/billing/portal'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ returnUrl: 'https://keyway.sh/billing' }),
        })
      )
      expect(result.url).toContain('stripe.com')
    })
  })

  describe('getOrganizationTrial', () => {
    it('should fetch trial info', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            status: 'active',
            startedAt: '2025-01-01T00:00:00Z',
            endsAt: '2025-01-16T00:00:00Z',
            convertedAt: null,
            daysRemaining: 10,
            trialDurationDays: 15,
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await orgBillingApi.getOrganizationTrial('acme')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/orgs/acme/trial'),
        expect.any(Object)
      )
      expect(result.status).toBe('active')
      expect(result.days_remaining).toBe(10)
      expect(result.trial_duration_days).toBe(15)
    })
  })

  describe('startOrganizationTrial', () => {
    it('should start a trial', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            message: 'Trial started successfully',
            trial: {
              status: 'active',
              startedAt: '2025-01-01T00:00:00Z',
              endsAt: '2025-01-16T00:00:00Z',
              convertedAt: null,
              daysRemaining: 15,
            },
          },
          meta: { requestId: 'req-1' },
        }),
      })

      const result = await orgBillingApi.startOrganizationTrial('acme')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/orgs/acme/trial/start'),
        expect.objectContaining({
          method: 'POST',
        })
      )
      expect(result.message).toBe('Trial started successfully')
      expect(result.trial.status).toBe('active')
      expect(result.trial.days_remaining).toBe(15)
    })
  })
})
