import { BaseApiClient } from './client'
import type { SyncPreview, SyncResult } from '../types'

class SyncApiClient extends BaseApiClient {
  async getSyncPreview(
    owner: string,
    repo: string,
    connectionId: string,
    projectId: string,
    keywayEnvironment: string,
    providerEnvironment: string
  ): Promise<SyncPreview> {
    const params = new URLSearchParams({
      connectionId,
      projectId,
      keywayEnvironment,
      providerEnvironment,
      direction: 'push',
      allowDelete: 'false',
    })
    const response = await this.request<{
      data: {
        toCreate: string[]
        toUpdate: string[]
        toDelete: string[]
        toSkip: string[]
      }
      meta: { requestId: string }
    }>(`/v1/integrations/vaults/${owner}/${repo}/sync/preview?${params}`)
    return response.data
  }

  async executeSync(
    owner: string,
    repo: string,
    connectionId: string,
    projectId: string,
    keywayEnvironment: string,
    providerEnvironment: string
  ): Promise<SyncResult> {
    const response = await this.request<{
      data: {
        status: 'success' | 'partial' | 'error'
        created: number
        updated: number
        deleted: number
        skipped: number
        error?: string
      }
      meta: { requestId: string }
    }>(`/v1/integrations/vaults/${owner}/${repo}/sync`, {
      method: 'POST',
      body: JSON.stringify({
        connectionId,
        projectId,
        keywayEnvironment,
        providerEnvironment,
        direction: 'push',
        allowDelete: false,
      }),
    })
    return response.data
  }
}

export const syncApi = new SyncApiClient()
