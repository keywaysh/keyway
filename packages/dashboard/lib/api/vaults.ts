import { BaseApiClient } from './client'
import type { Vault, ReadonlyReason } from '../types'

class VaultsApiClient extends BaseApiClient {
  async getVaults(): Promise<Vault[]> {
    const response = await this.request<{
      data: Array<{
        id: string
        repoOwner: string
        repoName: string
        repoAvatar: string
        secretCount: number
        environments: string[]
        permission: string
        isPrivate: boolean
        isReadOnly: boolean
        readonlyReason: ReadonlyReason
        syncs: Array<{
          id: string
          provider: string
          projectId: string
          projectName: string | null
          connectionId: string
          keywayEnvironment: string
          providerEnvironment: string
          lastSyncedAt: string | null
        }>
        updatedAt: string
      }>
      meta: {
        requestId: string
        pagination: { total: number; limit: number; offset: number; hasMore: boolean }
      }
    }>('/v1/vaults')
    return response.data.map(v => ({
      id: v.id,
      repo_name: v.repoName,
      repo_owner: v.repoOwner,
      repo_avatar: v.repoAvatar,
      environments: v.environments,
      secrets_count: v.secretCount,
      permission: v.permission as Vault['permission'],
      is_private: v.isPrivate,
      is_read_only: v.isReadOnly,
      readonly_reason: v.readonlyReason,
      syncs: (v.syncs || []).map(s => ({
        id: s.id,
        provider: s.provider,
        project_id: s.projectId,
        project_name: s.projectName,
        connection_id: s.connectionId,
        keyway_environment: s.keywayEnvironment,
        provider_environment: s.providerEnvironment,
        last_synced_at: s.lastSyncedAt,
      })),
      updated_at: v.updatedAt,
      created_at: v.updatedAt, // API doesn't return createdAt for list
    }))
  }

  async getVaultByRepo(owner: string, repo: string): Promise<Vault> {
    const response = await this.request<{
      data: {
        id: string
        repoFullName: string
        repoOwner: string
        repoName: string
        repoAvatar: string
        secretCount: number
        environments: string[]
        permission: string
        isPrivate: boolean
        isReadOnly: boolean
        readonlyReason: ReadonlyReason
        syncs: Array<{
          id: string
          provider: string
          projectId: string
          projectName: string | null
          connectionId: string
          keywayEnvironment: string
          providerEnvironment: string
          lastSyncedAt: string | null
        }>
        createdAt: string
        updatedAt: string
      }
      meta: { requestId: string }
    }>(`/v1/vaults/${owner}/${repo}`)
    const data = response.data
    return {
      id: data.id,
      repo_name: data.repoName,
      repo_owner: data.repoOwner,
      repo_avatar: data.repoAvatar,
      environments: data.environments,
      secrets_count: data.secretCount,
      permission: data.permission as Vault['permission'],
      is_private: data.isPrivate,
      is_read_only: data.isReadOnly,
      readonly_reason: data.readonlyReason,
      syncs: (data.syncs || []).map(s => ({
        id: s.id,
        provider: s.provider,
        project_id: s.projectId,
        project_name: s.projectName,
        connection_id: s.connectionId,
        keyway_environment: s.keywayEnvironment,
        provider_environment: s.providerEnvironment,
        last_synced_at: s.lastSyncedAt,
      })),
      updated_at: data.updatedAt,
      created_at: data.createdAt,
    }
  }

  async deleteVault(owner: string, repo: string): Promise<void> {
    await this.request<void>(`/v1/vaults/${owner}/${repo}`, {
      method: 'DELETE',
    })
  }
}

export const vaultsApi = new VaultsApiClient()
