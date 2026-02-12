import { BaseApiClient } from './client'
import type { Organization, OrganizationDetails, OrganizationMember, SyncMembersResult, AvailableOrgsResponse, ConnectOrgResponse } from '../types'

class OrganizationsApiClient extends BaseApiClient {
  async getOrganizations(): Promise<Organization[]> {
    const response = await this.request<{
      data: Array<{
        id: string
        login: string
        displayName: string
        avatarUrl: string
        plan: 'free' | 'team'
        role: 'owner' | 'member'
        memberCount: number
        vaultCount: number
        createdAt: string
      }>
      meta: { requestId: string }
    }>('/v1/orgs')
    return response.data.map(org => ({
      id: org.id,
      login: org.login,
      display_name: org.displayName,
      avatar_url: org.avatarUrl,
      plan: org.plan,
      role: org.role,
      member_count: org.memberCount,
      vault_count: org.vaultCount,
      created_at: org.createdAt,
    }))
  }

  async getOrganization(orgLogin: string): Promise<OrganizationDetails> {
    const response = await this.request<{
      data: {
        id: string
        login: string
        displayName: string
        avatarUrl: string
        plan: 'free' | 'team'
        role: 'owner' | 'member'
        memberCount: number
        vaultCount: number
        stripeCustomerId: string | null
        trial: {
          status: 'none' | 'active' | 'expired' | 'converted'
          startedAt: string | null
          endsAt: string | null
          convertedAt: string | null
          daysRemaining: number | null
        }
        effectivePlan: 'free' | 'team'
        defaultPermissions: Record<string, unknown>
        createdAt: string
        updatedAt: string
        trialDurationDays: number
      }
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}`)
    const org = response.data
    return {
      id: org.id,
      login: org.login,
      display_name: org.displayName,
      avatar_url: org.avatarUrl,
      plan: org.plan,
      role: org.role,
      member_count: org.memberCount,
      vault_count: org.vaultCount,
      stripe_customer_id: org.stripeCustomerId,
      trial: {
        status: org.trial.status,
        started_at: org.trial.startedAt,
        ends_at: org.trial.endsAt,
        converted_at: org.trial.convertedAt,
        days_remaining: org.trial.daysRemaining,
        trial_duration_days: org.trialDurationDays,
      },
      effective_plan: org.effectivePlan,
      default_permissions: org.defaultPermissions,
      created_at: org.createdAt,
      updated_at: org.updatedAt,
    }
  }

  async getOrganizationMembers(orgLogin: string): Promise<OrganizationMember[]> {
    const response = await this.request<{
      data: Array<{
        id: string
        username: string
        avatarUrl: string
        role: 'owner' | 'member'
        joinedAt: string
      }>
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}/members`)
    return response.data.map(m => ({
      id: m.id,
      username: m.username,
      avatar_url: m.avatarUrl,
      role: m.role,
      joined_at: m.joinedAt,
    }))
  }

  async syncOrganizationMembers(orgLogin: string): Promise<SyncMembersResult> {
    const response = await this.request<{
      data: {
        message: string
        added: number
        updated: number
        removed: number
      }
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}/members/sync`, {
      method: 'POST',
    })
    return response.data
  }

  async updateOrganization(orgLogin: string, data: { displayName?: string; defaultPermissions?: Record<string, unknown> }): Promise<OrganizationDetails> {
    const response = await this.request<{
      data: {
        id: string
        login: string
        displayName: string
        defaultPermissions: Record<string, unknown>
        updatedAt: string
      }
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
    return {
      id: response.data.id,
      login: response.data.login,
      display_name: response.data.displayName,
      avatar_url: '',
      plan: 'free',
      role: 'owner',
      member_count: 0,
      vault_count: 0,
      stripe_customer_id: null,
      trial: {
        status: 'none',
        started_at: null,
        ends_at: null,
        converted_at: null,
        days_remaining: null,
        trial_duration_days: 15,
      },
      effective_plan: 'free',
      default_permissions: response.data.defaultPermissions,
      created_at: '',
      updated_at: response.data.updatedAt,
    }
  }

  async getAvailableOrganizations(): Promise<AvailableOrgsResponse> {
    const response = await this.request<{
      data: {
        organizations: Array<{
          login: string
          display_name: string
          avatar_url: string
          status: 'ready' | 'needs_install' | 'contact_admin'
          user_role: 'admin' | 'member'
          already_connected: boolean
        }>
        install_url: string
      }
      meta: { requestId: string }
    }>('/v1/github/available-orgs')
    return response.data
  }

  async connectOrganization(orgLogin: string): Promise<ConnectOrgResponse> {
    const response = await this.request<{
      data: {
        organization: {
          id: string
          login: string
          displayName: string
          avatarUrl: string
          plan: 'free' | 'team'
          role: 'owner' | 'member'
          memberCount: number
          vaultCount: number
          stripeCustomerId: string | null
          trial: {
            status: 'none' | 'active' | 'expired' | 'converted'
            startedAt: string | null
            endsAt: string | null
            convertedAt: string | null
            daysRemaining: number | null
          }
          effectivePlan: 'free' | 'team'
          defaultPermissions: Record<string, unknown>
          createdAt: string
          updatedAt: string
          trialDurationDays: number
        }
        message: string
      }
      meta: { requestId: string }
    }>('/v1/orgs/connect', {
      method: 'POST',
      body: JSON.stringify({ orgLogin }),
    })
    const org = response.data.organization
    return {
      organization: {
        id: org.id,
        login: org.login,
        display_name: org.displayName,
        avatar_url: org.avatarUrl,
        plan: org.plan,
        role: org.role,
        member_count: org.memberCount,
        vault_count: org.vaultCount,
        stripe_customer_id: org.stripeCustomerId,
        trial: {
          status: org.trial.status,
          started_at: org.trial.startedAt,
          ends_at: org.trial.endsAt,
          converted_at: org.trial.convertedAt,
          days_remaining: org.trial.daysRemaining,
          trial_duration_days: org.trialDurationDays,
        },
        effective_plan: org.effectivePlan,
        default_permissions: org.defaultPermissions,
        created_at: org.createdAt,
        updated_at: org.updatedAt,
      },
      message: response.data.message,
    }
  }
}

export const organizationsApi = new OrganizationsApiClient()
