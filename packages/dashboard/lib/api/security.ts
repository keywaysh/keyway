import { BaseApiClient } from './client'
import type { SecurityAlert, SecurityOverview, AccessLogResponse } from '../types'

class SecurityApiClient extends BaseApiClient {
  async getMySecurityAlerts(options?: { limit?: number; offset?: number }): Promise<SecurityAlert[]> {
    const params = new URLSearchParams()
    if (options?.limit) params.set('limit', String(options.limit))
    if (options?.offset) params.set('offset', String(options.offset))

    const queryString = params.toString()
    const response = await this.request<{
      data: SecurityAlert[]
      meta: { requestId: string }
    }>(`/v1/users/me/security/alerts${queryString ? `?${queryString}` : ''}`)
    return response.data
  }

  async getSecurityOverview(): Promise<SecurityOverview> {
    const response = await this.request<{
      data: SecurityOverview
      meta: { requestId: string }
    }>('/v1/users/me/security/overview')
    return response.data
  }

  async getAccessLog(options?: {
    limit?: number
    offset?: number
    vaultId?: string
  }): Promise<AccessLogResponse> {
    const params = new URLSearchParams()
    if (options?.limit) params.set('limit', String(options.limit))
    if (options?.offset) params.set('offset', String(options.offset))
    if (options?.vaultId) params.set('vaultId', options.vaultId)

    const queryString = params.toString()
    const response = await this.request<{
      data: AccessLogResponse
      meta: { requestId: string }
    }>(`/v1/users/me/security/access-log${queryString ? `?${queryString}` : ''}`)
    return response.data
  }
}

export const securityApi = new SecurityApiClient()
