import { BaseApiClient } from './client'
import type { ActivityEvent } from '../types'

class ActivityApiClient extends BaseApiClient {
  async getActivity(): Promise<ActivityEvent[]> {
    const response = await this.request<{
      data: Array<{
        id: string
        action: string
        vaultId: string | null
        repoFullName: string | null
        actor: { id: string; username: string; avatarUrl: string | null }
        platform: 'cli' | 'web' | 'api'
        metadata: Record<string, unknown> | null
        timestamp: string
      }>
      meta: {
        requestId: string
        pagination: { total: number; limit: number; offset: number; hasMore: boolean }
      }
    }>('/v1/activity?limit=100')

    const actionToCategory = (action: string): ActivityEvent['category'] => {
      const categoryMap: Record<string, ActivityEvent['category']> = {
        vault_created: 'vaults',
        vault_deleted: 'vaults',
        environment_created: 'environments',
        environment_renamed: 'environments',
        environment_deleted: 'environments',
        secrets_pulled: 'access',
        secret_value_accessed: 'access',
        secret_version_value_accessed: 'access',
        permission_changed: 'access',
        secrets_pushed: 'secrets',
        secret_created: 'secrets',
        secret_updated: 'secrets',
        secret_deleted: 'secrets',
        secret_rotated: 'secrets',
        secret_trashed: 'secrets',
        secret_restored: 'secrets',
        secret_permanently_deleted: 'secrets',
        secret_version_restored: 'secrets',
        integration_connected: 'integrations',
        integration_disconnected: 'integrations',
        secrets_synced: 'integrations',
        plan_upgraded: 'billing',
        plan_downgraded: 'billing',
        github_app_installed: 'account',
        github_app_uninstalled: 'account',
        user_login: 'account',
        api_key_created: 'account',
        api_key_revoked: 'account',
      }
      return categoryMap[action] || 'secrets'
    }

    return response.data.map(a => ({
      id: a.id,
      action: a.action as ActivityEvent['action'],
      category: actionToCategory(a.action),
      vault_id: a.vaultId || '',
      vault_name: a.repoFullName || '',
      user_name: a.actor.username,
      user_avatar: a.actor.avatarUrl || '',
      platform: a.platform,
      timestamp: a.timestamp,
      secret_name: (a.metadata?.secretName as string) || (a.metadata?.key as string) || undefined,
      environment: (a.metadata?.environment as string) || undefined,
      count: (a.metadata?.count as number) || undefined,
    }))
  }
}

export const activityApi = new ActivityApiClient()
