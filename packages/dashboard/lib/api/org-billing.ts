import { BaseApiClient } from './client'
import type { OrganizationBillingStatus, TrialInfo } from '../types'

class OrgBillingApiClient extends BaseApiClient {
  async getOrganizationBilling(orgLogin: string): Promise<OrganizationBillingStatus> {
    const response = await this.request<{
      data: {
        plan: 'free' | 'team'
        effectivePlan: 'free' | 'team'
        billingStatus: 'active' | 'past_due' | 'canceled' | 'trialing' | null
        stripeCustomerId: string | null
        subscription: {
          id: string
          status: string
          currentPeriodEnd: string
          cancelAtPeriodEnd: boolean
        } | null
        trial: {
          status: 'none' | 'active' | 'expired' | 'converted'
          startedAt: string | null
          endsAt: string | null
          convertedAt: string | null
          daysRemaining: number | null
          trialDurationDays: number
        }
        prices: {
          monthly: { id: string; price: number; interval: string }
          yearly: { id: string; price: number; interval: string }
        } | null
      }
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}/billing`)
    const d = response.data
    return {
      plan: d.plan,
      effective_plan: d.effectivePlan,
      billing_status: d.billingStatus,
      stripe_customer_id: d.stripeCustomerId,
      subscription: d.subscription ? {
        id: d.subscription.id,
        status: d.subscription.status,
        current_period_end: d.subscription.currentPeriodEnd,
        cancel_at_period_end: d.subscription.cancelAtPeriodEnd,
      } : null,
      trial: {
        status: d.trial.status,
        started_at: d.trial.startedAt,
        ends_at: d.trial.endsAt,
        converted_at: d.trial.convertedAt,
        days_remaining: d.trial.daysRemaining,
        trial_duration_days: d.trial.trialDurationDays,
      },
      prices: d.prices,
    }
  }

  async createOrganizationCheckoutSession(orgLogin: string, priceId: string, successUrl: string, cancelUrl: string): Promise<{ url: string }> {
    const response = await this.request<{
      data: { url: string }
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}/billing/checkout`, {
      method: 'POST',
      body: JSON.stringify({ priceId, successUrl, cancelUrl }),
    })
    return response.data
  }

  async createOrganizationPortalSession(orgLogin: string, returnUrl: string): Promise<{ url: string }> {
    const response = await this.request<{
      data: { url: string }
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}/billing/portal`, {
      method: 'POST',
      body: JSON.stringify({ returnUrl }),
    })
    return response.data
  }

  async getOrganizationTrial(orgLogin: string): Promise<TrialInfo> {
    const response = await this.request<{
      data: {
        status: 'none' | 'active' | 'expired' | 'converted'
        startedAt: string | null
        endsAt: string | null
        convertedAt: string | null
        daysRemaining: number | null
        trialDurationDays: number
      }
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}/trial`)
    const t = response.data
    return {
      status: t.status,
      started_at: t.startedAt,
      ends_at: t.endsAt,
      converted_at: t.convertedAt,
      days_remaining: t.daysRemaining,
      trial_duration_days: t.trialDurationDays,
    }
  }

  async startOrganizationTrial(orgLogin: string): Promise<{ message: string; trial: TrialInfo }> {
    const response = await this.request<{
      data: {
        message: string
        trial: {
          status: 'none' | 'active' | 'expired' | 'converted'
          startedAt: string | null
          endsAt: string | null
          convertedAt: string | null
          daysRemaining: number | null
        }
      }
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}/trial/start`, {
      method: 'POST',
    })
    const t = response.data.trial
    return {
      message: response.data.message,
      trial: {
        status: t.status,
        started_at: t.startedAt,
        ends_at: t.endsAt,
        converted_at: t.convertedAt,
        days_remaining: t.daysRemaining,
        trial_duration_days: 15,
      },
    }
  }
}

export const orgBillingApi = new OrgBillingApiClient()
