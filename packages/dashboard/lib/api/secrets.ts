import { BaseApiClient } from './client'
import type { Secret, SecretVersion } from '../types'

class SecretsApiClient extends BaseApiClient {
  async getSecretsByRepo(owner: string, repo: string): Promise<Secret[]> {
    const response = await this.request<{
      data: Array<{
        id: string
        key: string
        environment: string
        createdAt: string
        updatedAt: string
        lastModifiedBy: { username: string; avatarUrl: string | null } | null
      }>
      meta: {
        requestId: string
        pagination: { total: number; limit: number; offset: number; hasMore: boolean }
      }
    }>(`/v1/vaults/${owner}/${repo}/secrets?limit=100`)
    return response.data.map(s => ({
      id: s.id,
      name: s.key,
      environment: s.environment,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
      last_modified_by: s.lastModifiedBy
        ? { username: s.lastModifiedBy.username, avatar_url: s.lastModifiedBy.avatarUrl }
        : null,
    }))
  }

  async createSecretByRepo(owner: string, repo: string, data: { name: string; value: string; environment: string }): Promise<Secret> {
    const response = await this.request<{
      data: { id: string; status: string }
      meta: { requestId: string }
    }>(`/v1/vaults/${owner}/${repo}/secrets`, {
      method: 'POST',
      body: JSON.stringify({ key: data.name, value: data.value, environment: data.environment }),
    })
    return {
      id: response.data.id,
      name: data.name,
      environment: data.environment,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_modified_by: null,
    }
  }

  async updateSecretByRepo(owner: string, repo: string, secretId: string, data: { name?: string; value?: string }): Promise<Secret> {
    const response = await this.request<{
      data: {
        id: string
        key: string
        environment: string
        createdAt: string
        updatedAt: string
        lastModifiedBy: { username: string; avatarUrl: string | null } | null
      }
      meta: { requestId: string }
    }>(`/v1/vaults/${owner}/${repo}/secrets/${secretId}`, {
      method: 'PATCH',
      body: JSON.stringify({ key: data.name, value: data.value }),
    })
    const res = response.data
    return {
      id: res.id,
      name: res.key,
      environment: res.environment,
      created_at: res.createdAt,
      updated_at: res.updatedAt,
      last_modified_by: res.lastModifiedBy
        ? { username: res.lastModifiedBy.username, avatar_url: res.lastModifiedBy.avatarUrl }
        : null,
    }
  }

  async deleteSecretByRepo(owner: string, repo: string, secretId: string): Promise<{
    id: string
    key: string
    environment: string
    deletedAt: string
    expiresAt: string
  }> {
    const response = await this.request<{
      data: {
        id: string
        key: string
        environment: string
        deletedAt: string
        expiresAt: string
        message: string
      }
      meta: { requestId: string }
    }>(`/v1/vaults/${owner}/${repo}/secrets/${secretId}`, {
      method: 'DELETE',
    })
    return response.data
  }

  async getSecretValue(owner: string, repo: string, secretId: string): Promise<{ value: string; preview: string }> {
    const response = await this.request<{
      data: { value: string; preview: string }
      meta: { requestId: string }
    }>(`/v1/vaults/${owner}/${repo}/secrets/${secretId}/value`)
    return response.data
  }

  async getSecretVersions(owner: string, repo: string, secretId: string): Promise<SecretVersion[]> {
    const response = await this.request<{
      data: {
        versions: Array<{
          id: string
          versionNumber: number
          createdAt: string
          createdBy: { username: string; avatarUrl: string | null } | null
        }>
      }
      meta: { requestId: string }
    }>(`/v1/vaults/${owner}/${repo}/secrets/${secretId}/versions`)
    return response.data.versions.map(v => ({
      id: v.id,
      version_number: v.versionNumber,
      created_at: v.createdAt,
      created_by: v.createdBy
        ? { username: v.createdBy.username, avatar_url: v.createdBy.avatarUrl }
        : null,
    }))
  }

  async getSecretVersionValue(owner: string, repo: string, secretId: string, versionId: string): Promise<{ value: string; versionNumber: number }> {
    const response = await this.request<{
      data: { value: string; versionNumber: number }
      meta: { requestId: string }
    }>(`/v1/vaults/${owner}/${repo}/secrets/${secretId}/versions/${versionId}/value`)
    return response.data
  }

  async restoreSecretVersion(owner: string, repo: string, secretId: string, versionId: string): Promise<{ key: string; versionNumber: number }> {
    const response = await this.request<{
      data: { message: string; key: string; versionNumber: number }
      meta: { requestId: string }
    }>(`/v1/vaults/${owner}/${repo}/secrets/${secretId}/versions/${versionId}/restore`, {
      method: 'POST',
    })
    return { key: response.data.key, versionNumber: response.data.versionNumber }
  }
}

export const secretsApi = new SecretsApiClient()
