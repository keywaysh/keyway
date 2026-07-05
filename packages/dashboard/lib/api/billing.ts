import { BaseApiClient } from './client'

// Shape actually served by GET /v1/billing/prices: each interval slot is null
// when the Stripe lookup_key is unresolved, and currency is always present.
// pro is being retired server-side; newer API responses omit it.
export type ApiPrice = { id: string; price: number; currency: string; interval: string }
export type PlanPrices = { monthly: ApiPrice | null; yearly: ApiPrice | null }
export type PricesData = {
  prices: {
    pro?: PlanPrices
    team?: PlanPrices
    business?: PlanPrices
  }
}

class BillingApiClient extends BaseApiClient {
  async getSubscription(): Promise<{
    subscription: {
      id: string
      status: string
      currentPeriodEnd: string
      cancelAtPeriodEnd: boolean
    } | null
    plan: 'free' | 'pro' | 'team'
    billingStatus: 'active' | 'past_due' | 'canceled' | 'trialing'
    stripeCustomerId: string | null
  }> {
    const response = await this.request<{
      data: {
        subscription: {
          id: string
          status: string
          currentPeriodEnd: string
          cancelAtPeriodEnd: boolean
        } | null
        plan: 'free' | 'pro' | 'team'
        billingStatus: 'active' | 'past_due' | 'canceled' | 'trialing'
        stripeCustomerId: string | null
      }
      meta: { requestId: string }
    }>('/v1/billing/subscription')
    return response.data
  }

  async getPrices(): Promise<PricesData> {
    const response = await this.request<{
      data: PricesData
      meta: { requestId: string }
    }>('/v1/billing/prices')
    return response.data
  }

  async createCheckoutSession(priceId: string, successUrl: string, cancelUrl: string): Promise<{ url: string }> {
    const response = await this.request<{
      data: { url: string }
      meta: { requestId: string }
    }>('/v1/billing/create-checkout-session', {
      method: 'POST',
      body: JSON.stringify({ priceId, successUrl, cancelUrl }),
    })
    return response.data
  }

  async createPortalSession(returnUrl: string): Promise<{ url: string }> {
    const response = await this.request<{
      data: { url: string }
      meta: { requestId: string }
    }>('/v1/billing/manage', {
      method: 'POST',
      body: JSON.stringify({ returnUrl }),
    })
    return response.data
  }
}

export const billingApi = new BillingApiClient()
