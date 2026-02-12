import { BaseApiClient } from './client'

type EnvironmentInfo = {
  name: string
  type: 'protected' | 'standard' | 'development'
  displayOrder: number
}

class EnvironmentsApiClient extends BaseApiClient {
  async getEnvironments(owner: string, repo: string): Promise<string[]> {
    const response = await this.request<{
      data: { environments: EnvironmentInfo[] }
      meta: { requestId: string }
    }>(`/v1/vaults/${owner}/${repo}/environments`)
    // Extract just the names for backwards compatibility
    return response.data.environments.map(env => env.name)
  }

  async createEnvironment(owner: string, repo: string, name: string): Promise<{ environment: string; environments: string[] }> {
    const response = await this.request<{
      data: { environment: EnvironmentInfo; environments: EnvironmentInfo[] }
      meta: { requestId: string }
    }>(`/v1/vaults/${owner}/${repo}/environments`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    return {
      environment: response.data.environment.name,
      environments: response.data.environments.map(env => env.name),
    }
  }

  async renameEnvironment(owner: string, repo: string, oldName: string, newName: string): Promise<{ oldName: string; newName: string; environments: string[] }> {
    const response = await this.request<{
      data: { oldName: string; newName: string; environments: EnvironmentInfo[] }
      meta: { requestId: string }
    }>(`/v1/vaults/${owner}/${repo}/environments/${encodeURIComponent(oldName)}`, {
      method: 'PATCH',
      body: JSON.stringify({ newName }),
    })
    return {
      oldName: response.data.oldName,
      newName: response.data.newName,
      environments: response.data.environments.map(env => env.name),
    }
  }

  async deleteEnvironment(owner: string, repo: string, name: string): Promise<{ deleted: string; environments: string[] }> {
    const response = await this.request<{
      data: { deleted: string; environments: EnvironmentInfo[] }
      meta: { requestId: string }
    }>(`/v1/vaults/${owner}/${repo}/environments/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    })
    return {
      deleted: response.data.deleted,
      environments: response.data.environments.map(env => env.name),
    }
  }
}

export const environmentsApi = new EnvironmentsApiClient()
