import { BaseApiClient } from './client'
import type { Secret, TrashedSecret } from '../types'

class TrashApiClient extends BaseApiClient {
  async getTrashedSecrets(owner: string, repo: string): Promise<TrashedSecret[]> {
    const response = await this.request<{
      data: Array<{ id: string; key: string; environment: string; deletedAt: string; expiresAt: string; daysRemaining: number }>
      meta: {
        requestId: string
        pagination: { total: number; limit: number; offset: number; hasMore: boolean }
      }
    }>(`/v1/vaults/${owner}/${repo}/trash?limit=100`)
    return response.data.map(s => ({
      id: s.id,
      name: s.key,
      environment: s.environment,
      deleted_at: s.deletedAt,
      expires_at: s.expiresAt,
      days_remaining: s.daysRemaining,
    }))
  }

  async restoreSecret(owner: string, repo: string, secretId: string): Promise<Secret> {
    const response = await this.request<{
      data: { id: string; key: string; environment: string; message: string }
      meta: { requestId: string }
    }>(`/v1/vaults/${owner}/${repo}/trash/${secretId}/restore`, {
      method: 'POST',
    })
    const res = response.data
    return {
      id: res.id,
      name: res.key,
      environment: res.environment,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_modified_by: null,
    }
  }

  async permanentlyDeleteSecret(owner: string, repo: string, secretId: string): Promise<void> {
    await this.request<void>(`/v1/vaults/${owner}/${repo}/trash/${secretId}`, {
      method: 'DELETE',
    })
  }

  async emptyTrash(owner: string, repo: string): Promise<{ deleted: number }> {
    const response = await this.request<{
      data: { deleted: number; message: string }
      meta: { requestId: string }
    }>(`/v1/vaults/${owner}/${repo}/trash`, {
      method: 'DELETE',
    })
    return { deleted: response.data.deleted }
  }
}

export const trashApi = new TrashApiClient()
