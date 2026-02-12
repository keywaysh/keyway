import { BaseApiClient } from './client'
import type { User } from '../types'

class UsersApiClient extends BaseApiClient {
  async getUsage(): Promise<{
    plan: 'free' | 'pro' | 'team'
    limits: {
      maxPublicRepos: string | number
      maxPrivateRepos: string | number
      maxProviders: string | number
      maxEnvironmentsPerVault: string | number
      maxSecretsPerPrivateVault: string | number
    }
    usage: {
      public: number
      private: number
      providers: number
    }
  }> {
    const response = await this.request<{
      data: {
        plan: 'free' | 'pro' | 'team'
        limits: {
          maxPublicRepos: string | number
          maxPrivateRepos: string | number
          maxProviders: string | number
          maxEnvironmentsPerVault: string | number
          maxSecretsPerPrivateVault: string | number
        }
        usage: {
          public: number
          private: number
          providers: number
        }
      }
      meta: { requestId: string }
    }>('/v1/users/me/usage')
    return response.data
  }

  async getMe(): Promise<User> {
    const response = await this.request<{
      data: {
        id: string | null
        githubId: number
        username: string
        email: string | null
        avatarUrl: string | null
        createdAt: string | null
        plan?: 'free' | 'pro' | 'team'
      }
      meta: { requestId: string }
    }>('/v1/users/me')
    const data = response.data
    return {
      id: data.id || String(data.githubId),
      name: data.username,
      email: data.email || '',
      avatar_url: data.avatarUrl || '',
      github_username: data.username,
      plan: data.plan || 'free',
      created_at: data.createdAt || null,
    }
  }
}

export const usersApi = new UsersApiClient()
