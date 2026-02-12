import { BaseApiClient } from './client'
import type { Collaborator } from '../types'

class CollaboratorsApiClient extends BaseApiClient {
  async getVaultCollaborators(owner: string, repo: string): Promise<Collaborator[]> {
    const response = await this.request<{
      data: {
        repoId: string
        provider: string
        contributors: Collaborator[]
      }
      meta: { requestId: string }
    }>(`/v1/vaults/${owner}/${repo}/contributors`)
    return response.data.contributors
  }
}

export const collaboratorsApi = new CollaboratorsApiClient()
