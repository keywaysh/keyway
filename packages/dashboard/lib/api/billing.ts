import { BaseApiClient } from './client'
import type { UserPlan } from '../types'

// Shape actually served by GET /v1/billing/prices: each interval slot is null
// when the Stripe lookup_key is unresolved, and currency is always present.
export type ApiPrice = { id: string; price: number; currency: string; interval: string }

const CURRENCY_SYMBOLS: Record<string, string> = { eur: '€', usd: '$' }

export function currencySymbol(currency?: string): string {
  return (currency && CURRENCY_SYMBOLS[currency.toLowerCase()]) || '€'
}

/** Format a Stripe amount in cents for display (whole units unless there are cents) */
export function formatAmount(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)
}
export type PlanPrices = { monthly: ApiPrice | null; yearly: ApiPrice | null }
export type PricesData = {
  prices: {
    team?: PlanPrices
    business?: PlanPrices
  }
}

export type SubscriptionData = {
  subscription: {
    id: string
    status: string
    currentPeriodEnd: string
    cancelAtPeriodEnd: boolean
  } | null
  plan: UserPlan
  billingStatus: 'active' | 'past_due' | 'canceled' | 'trialing'
  stripeCustomerId: string | null
}

class BillingApiClient extends BaseApiClient {
  async getSubscription(): Promise<SubscriptionData> {
    const response = await this.request<{
      data: SubscriptionData
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

  // Personal checkout: owner-as-container — a personal account subscribes to
  // the same flat Team/Business plans as an organization (org checkout lives
  // in org-billing.ts)
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
