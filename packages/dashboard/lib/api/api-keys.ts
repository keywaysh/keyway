import { BaseApiClient } from './client'
import type { ApiKey, CreateApiKeyRequest, CreateApiKeyResponse } from '../types'

class ApiKeysApiClient extends BaseApiClient {
  async getApiKeys(): Promise<ApiKey[]> {
    const response = await this.request<{
      data: { keys: ApiKey[] }
      meta: { requestId: string }
    }>('/v1/api-keys')
    return response.data.keys
  }

  async getApiKey(id: string): Promise<ApiKey> {
    const response = await this.request<{
      data: ApiKey
      meta: { requestId: string }
    }>(`/v1/api-keys/${id}`)
    return response.data
  }

  async createApiKey(data: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
    const response = await this.request<{
      data: CreateApiKeyResponse
      meta: { requestId: string }
    }>('/v1/api-keys', {
      method: 'POST',
      body: JSON.stringify(data),
    })
    return response.data
  }

  async revokeApiKey(id: string): Promise<void> {
    await this.request<void>(`/v1/api-keys/${id}`, {
      method: 'DELETE',
    })
  }
}

export const apiKeysApi = new ApiKeysApiClient()
