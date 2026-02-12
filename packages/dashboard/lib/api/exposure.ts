import { BaseApiClient } from './client'
import type { ExposureOrgSummary, ExposureUserReport } from '../types'

class ExposureApiClient extends BaseApiClient {
  async getMyExposure(options?: {
    startDate?: string
    endDate?: string
    limit?: number
    offset?: number
  }): Promise<ExposureOrgSummary> {
    const params = new URLSearchParams()
    if (options?.startDate) params.set('startDate', options.startDate)
    if (options?.endDate) params.set('endDate', options.endDate)
    if (options?.limit) params.set('limit', String(options.limit))
    if (options?.offset) params.set('offset', String(options.offset))

    const queryString = params.toString()
    const response = await this.request<{
      data: ExposureOrgSummary
      meta: { requestId: string }
    }>(`/v1/users/me/exposure${queryString ? `?${queryString}` : ''}`)
    return response.data
  }

  async getMyExposureUser(username: string): Promise<ExposureUserReport> {
    const response = await this.request<{
      data: ExposureUserReport
      meta: { requestId: string }
    }>(`/v1/users/me/exposure/${encodeURIComponent(username)}`)
    return response.data
  }

  async getOrganizationExposure(
    orgLogin: string,
    options?: { startDate?: string; endDate?: string; vaultId?: string; limit?: number; offset?: number }
  ): Promise<ExposureOrgSummary> {
    const params = new URLSearchParams()
    if (options?.startDate) params.set('startDate', options.startDate)
    if (options?.endDate) params.set('endDate', options.endDate)
    if (options?.vaultId) params.set('vaultId', options.vaultId)
    if (options?.limit) params.set('limit', String(options.limit))
    if (options?.offset) params.set('offset', String(options.offset))

    const queryString = params.toString()
    const response = await this.request<{
      data: ExposureOrgSummary
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}/exposure${queryString ? `?${queryString}` : ''}`)
    return response.data
  }

  async getUserExposure(orgLogin: string, username: string): Promise<ExposureUserReport> {
    const response = await this.request<{
      data: ExposureUserReport
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}/exposure/${encodeURIComponent(username)}`)
    return response.data
  }
}

export const exposureApi = new ExposureApiClient()
