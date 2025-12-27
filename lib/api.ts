import type { User, Vault, Secret, TrashedSecret, SecretVersion, ActivityEvent, Collaborator, ApiKey, CreateApiKeyRequest, CreateApiKeyResponse, Organization, OrganizationDetails, OrganizationMember, OrganizationBillingStatus, TrialInfo, SyncMembersResult, SyncPreview, SyncResult, ExposureOrgSummary, ExposureUserReport, AvailableOrg, AvailableOrgsResponse, ConnectOrgResponse, SecurityAlert, SecurityOverview, AccessLogResponse } from './types'

const API_BASE = process.env.NEXT_PUBLIC_KEYWAY_API_URL || 'https://api.keyway.sh'

class ApiClient {
  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      ...options?.headers as Record<string, string>,
    }
    // Only set Content-Type for requests with body
    if (options?.body) {
      headers['Content-Type'] = 'application/json'
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers,
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: 'Request failed' }))
      // RFC 7807 format uses 'detail', fallback to 'message' for backwards compatibility
      throw new Error(error.detail || error.message || `Request failed: ${res.status}`)
    }

    // Handle 204 No Content responses
    if (res.status === 204) {
      return undefined as T
    }

    return res.json()
  }

  async getUsage(): Promise<{
    plan: 'free' | 'pro' | 'team'
    limits: {
      maxPublicRepos: string | number
      maxPrivateRepos: string | number
      maxProviders: string | number
      maxEnvironmentsPerVault: string | number
      maxSecretsPerPrivateVault: string | number
    }
    usage: {
      public: number
      private: number
      providers: number
    }
  }> {
    const response = await this.request<{
      data: {
        plan: 'free' | 'pro' | 'team'
        limits: {
          maxPublicRepos: string | number
          maxPrivateRepos: string | number
          maxProviders: string | number
          maxEnvironmentsPerVault: string | number
          maxSecretsPerPrivateVault: string | number
        }
        usage: {
          public: number
          private: number
          providers: number
        }
      }
      meta: { requestId: string }
    }>('/v1/users/me/usage')
    return response.data
  }

  async getMe(): Promise<User> {
    const response = await this.request<{
      data: {
        id: string | null
        githubId: number
        username: string
        email: string | null
        avatarUrl: string | null
        createdAt: string | null
        plan?: 'free' | 'pro' | 'team'
      }
      meta: { requestId: string }
    }>('/v1/users/me')
    const data = response.data
    return {
      id: data.id || String(data.githubId),
      name: data.username,
      email: data.email || '',
      avatar_url: data.avatarUrl || '',
      github_username: data.username,
      plan: data.plan || 'free',
    }
  }

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
    // Return a partial secret (we don't get full data back from create)
    // last_modified_by will be populated on next fetch
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

  // Secret version history
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

  async deleteVault(owner: string, repo: string): Promise<void> {
    await this.request<void>(`/v1/vaults/${owner}/${repo}`, {
      method: 'DELETE',
    })
  }

  // Trash operations
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

    // Map action to category for filtering
    // Using explicit mapping for accuracy instead of string matching
    const actionToCategory = (action: string): ActivityEvent['category'] => {
      const categoryMap: Record<string, ActivityEvent['category']> = {
        // Vault actions
        vault_created: 'vaults',
        vault_deleted: 'vaults',
        // Environment actions
        environment_created: 'environments',
        environment_renamed: 'environments',
        environment_deleted: 'environments',
        // Access actions (reading/pulling secrets, permissions)
        secrets_pulled: 'access',
        secret_value_accessed: 'access',
        secret_version_value_accessed: 'access',
        permission_changed: 'access',
        // Secret mutations
        secrets_pushed: 'secrets',
        secret_created: 'secrets',
        secret_updated: 'secrets',
        secret_deleted: 'secrets',
        secret_rotated: 'secrets',
        secret_trashed: 'secrets',
        secret_restored: 'secrets',
        secret_permanently_deleted: 'secrets',
        secret_version_restored: 'secrets',
        // Integration actions
        integration_connected: 'integrations',
        integration_disconnected: 'integrations',
        secrets_synced: 'integrations',
        // Billing actions
        plan_upgraded: 'billing',
        plan_downgraded: 'billing',
        // Account actions (auth, github app, api keys)
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
      // Extract metadata (secretName from backend, key for backwards compat)
      secret_name: (a.metadata?.secretName as string) || (a.metadata?.key as string) || undefined,
      environment: (a.metadata?.environment as string) || undefined,
      count: (a.metadata?.count as number) || undefined,
    }))
  }

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

  // Environment management
  async getEnvironments(owner: string, repo: string): Promise<string[]> {
    const response = await this.request<{
      data: { environments: string[] }
      meta: { requestId: string }
    }>(`/v1/vaults/${owner}/${repo}/environments`)
    return response.data.environments
  }

  async createEnvironment(owner: string, repo: string, name: string): Promise<{ environment: string; environments: string[] }> {
    const response = await this.request<{
      data: { environment: string; environments: string[] }
      meta: { requestId: string }
    }>(`/v1/vaults/${owner}/${repo}/environments`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    return response.data
  }

  async renameEnvironment(owner: string, repo: string, oldName: string, newName: string): Promise<{ oldName: string; newName: string; environments: string[] }> {
    const response = await this.request<{
      data: { oldName: string; newName: string; environments: string[] }
      meta: { requestId: string }
    }>(`/v1/vaults/${owner}/${repo}/environments/${encodeURIComponent(oldName)}`, {
      method: 'PATCH',
      body: JSON.stringify({ newName }),
    })
    return response.data
  }

  async deleteEnvironment(owner: string, repo: string, name: string): Promise<{ deleted: string; environments: string[] }> {
    const response = await this.request<{
      data: { deleted: string; environments: string[] }
      meta: { requestId: string }
    }>(`/v1/vaults/${owner}/${repo}/environments/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    })
    return response.data
  }

  // Collaborators
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

  // Billing methods
  async getSubscription(): Promise<{
    subscription: {
      id: string
      status: string
      currentPeriodEnd: string
      cancelAtPeriodEnd: boolean
    } | null
    plan: 'free' | 'pro' | 'team'
    billingStatus: 'active' | 'past_due' | 'canceled' | 'trialing'
    stripeCustomerId: string | null
  }> {
    const response = await this.request<{
      data: {
        subscription: {
          id: string
          status: string
          currentPeriodEnd: string
          cancelAtPeriodEnd: boolean
        } | null
        plan: 'free' | 'pro' | 'team'
        billingStatus: 'active' | 'past_due' | 'canceled' | 'trialing'
        stripeCustomerId: string | null
      }
      meta: { requestId: string }
    }>('/v1/billing/subscription')
    return response.data
  }

  async getPrices(): Promise<{
    prices: {
      pro: {
        monthly: { id: string; price: number; interval: string }
        yearly: { id: string; price: number; interval: string }
      }
    }
  }> {
    const response = await this.request<{
      data: {
        prices: {
          pro: {
            monthly: { id: string; price: number; interval: string }
            yearly: { id: string; price: number; interval: string }
          }
        }
      }
      meta: { requestId: string }
    }>('/v1/billing/prices')
    return response.data
  }

  async createCheckoutSession(priceId: string, successUrl: string, cancelUrl: string): Promise<{ url: string }> {
    const response = await this.request<{
      data: { url: string }
      meta: { requestId: string }
    }>('/v1/billing/create-checkout-session', {
      method: 'POST',
      body: JSON.stringify({ priceId, successUrl, cancelUrl }),
    })
    return response.data
  }

  async createPortalSession(returnUrl: string): Promise<{ url: string }> {
    const response = await this.request<{
      data: { url: string }
      meta: { requestId: string }
    }>('/v1/billing/manage', {
      method: 'POST',
      body: JSON.stringify({ returnUrl }),
    })
    return response.data
  }

  // API Keys
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

  // ==========================================================================
  // Organization methods
  // ==========================================================================

  async getOrganizations(): Promise<Organization[]> {
    const response = await this.request<{
      data: Array<{
        id: string
        login: string
        displayName: string
        avatarUrl: string
        plan: 'free' | 'team'
        role: 'owner' | 'member'
        memberCount: number
        vaultCount: number
        createdAt: string
      }>
      meta: { requestId: string }
    }>('/v1/orgs')
    return response.data.map(org => ({
      id: org.id,
      login: org.login,
      display_name: org.displayName,
      avatar_url: org.avatarUrl,
      plan: org.plan,
      role: org.role,
      member_count: org.memberCount,
      vault_count: org.vaultCount,
      created_at: org.createdAt,
    }))
  }

  async getOrganization(orgLogin: string): Promise<OrganizationDetails> {
    const response = await this.request<{
      data: {
        id: string
        login: string
        displayName: string
        avatarUrl: string
        plan: 'free' | 'team'
        role: 'owner' | 'member'
        memberCount: number
        vaultCount: number
        stripeCustomerId: string | null
        trial: {
          status: 'none' | 'active' | 'expired' | 'converted'
          startedAt: string | null
          endsAt: string | null
          convertedAt: string | null
          daysRemaining: number | null
        }
        effectivePlan: 'free' | 'team'
        defaultPermissions: Record<string, unknown>
        createdAt: string
        updatedAt: string
        trialDurationDays: number
      }
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}`)
    const org = response.data
    return {
      id: org.id,
      login: org.login,
      display_name: org.displayName,
      avatar_url: org.avatarUrl,
      plan: org.plan,
      role: org.role,
      member_count: org.memberCount,
      vault_count: org.vaultCount,
      stripe_customer_id: org.stripeCustomerId,
      trial: {
        status: org.trial.status,
        started_at: org.trial.startedAt,
        ends_at: org.trial.endsAt,
        converted_at: org.trial.convertedAt,
        days_remaining: org.trial.daysRemaining,
        trial_duration_days: org.trialDurationDays,
      },
      effective_plan: org.effectivePlan,
      default_permissions: org.defaultPermissions,
      created_at: org.createdAt,
      updated_at: org.updatedAt,
    }
  }

  async getOrganizationMembers(orgLogin: string): Promise<OrganizationMember[]> {
    const response = await this.request<{
      data: Array<{
        id: string
        username: string
        avatarUrl: string
        role: 'owner' | 'member'
        joinedAt: string
      }>
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}/members`)
    return response.data.map(m => ({
      id: m.id,
      username: m.username,
      avatar_url: m.avatarUrl,
      role: m.role,
      joined_at: m.joinedAt,
    }))
  }

  async syncOrganizationMembers(orgLogin: string): Promise<SyncMembersResult> {
    const response = await this.request<{
      data: {
        message: string
        added: number
        updated: number
        removed: number
      }
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}/members/sync`, {
      method: 'POST',
    })
    return response.data
  }

  async updateOrganization(orgLogin: string, data: { displayName?: string; defaultPermissions?: Record<string, unknown> }): Promise<OrganizationDetails> {
    const response = await this.request<{
      data: {
        id: string
        login: string
        displayName: string
        defaultPermissions: Record<string, unknown>
        updatedAt: string
      }
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
    // Return partial data, caller should refetch if needed
    return {
      id: response.data.id,
      login: response.data.login,
      display_name: response.data.displayName,
      avatar_url: '',
      plan: 'free',
      role: 'owner',
      member_count: 0,
      vault_count: 0,
      stripe_customer_id: null,
      trial: {
        status: 'none',
        started_at: null,
        ends_at: null,
        converted_at: null,
        days_remaining: null,
        trial_duration_days: 15,
      },
      effective_plan: 'free',
      default_permissions: response.data.defaultPermissions,
      created_at: '',
      updated_at: response.data.updatedAt,
    }
  }

  // Organization Billing
  async getOrganizationBilling(orgLogin: string): Promise<OrganizationBillingStatus> {
    const response = await this.request<{
      data: {
        plan: 'free' | 'team'
        effectivePlan: 'free' | 'team'
        billingStatus: 'active' | 'past_due' | 'canceled' | 'trialing' | null
        stripeCustomerId: string | null
        subscription: {
          id: string
          status: string
          currentPeriodEnd: string
          cancelAtPeriodEnd: boolean
        } | null
        trial: {
          status: 'none' | 'active' | 'expired' | 'converted'
          startedAt: string | null
          endsAt: string | null
          convertedAt: string | null
          daysRemaining: number | null
          trialDurationDays: number
        }
        prices: {
          monthly: { id: string; price: number; interval: string }
          yearly: { id: string; price: number; interval: string }
        } | null
      }
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}/billing`)
    const d = response.data
    return {
      plan: d.plan,
      effective_plan: d.effectivePlan,
      billing_status: d.billingStatus,
      stripe_customer_id: d.stripeCustomerId,
      subscription: d.subscription ? {
        id: d.subscription.id,
        status: d.subscription.status,
        current_period_end: d.subscription.currentPeriodEnd,
        cancel_at_period_end: d.subscription.cancelAtPeriodEnd,
      } : null,
      trial: {
        status: d.trial.status,
        started_at: d.trial.startedAt,
        ends_at: d.trial.endsAt,
        converted_at: d.trial.convertedAt,
        days_remaining: d.trial.daysRemaining,
        trial_duration_days: d.trial.trialDurationDays,
      },
      prices: d.prices,
    }
  }

  async createOrganizationCheckoutSession(orgLogin: string, priceId: string, successUrl: string, cancelUrl: string): Promise<{ url: string }> {
    const response = await this.request<{
      data: { url: string }
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}/billing/checkout`, {
      method: 'POST',
      body: JSON.stringify({ priceId, successUrl, cancelUrl }),
    })
    return response.data
  }

  async createOrganizationPortalSession(orgLogin: string, returnUrl: string): Promise<{ url: string }> {
    const response = await this.request<{
      data: { url: string }
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}/billing/portal`, {
      method: 'POST',
      body: JSON.stringify({ returnUrl }),
    })
    return response.data
  }

  // Organization Trials
  async getOrganizationTrial(orgLogin: string): Promise<TrialInfo> {
    const response = await this.request<{
      data: {
        status: 'none' | 'active' | 'expired' | 'converted'
        startedAt: string | null
        endsAt: string | null
        convertedAt: string | null
        daysRemaining: number | null
        trialDurationDays: number
      }
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}/trial`)
    const t = response.data
    return {
      status: t.status,
      started_at: t.startedAt,
      ends_at: t.endsAt,
      converted_at: t.convertedAt,
      days_remaining: t.daysRemaining,
      trial_duration_days: t.trialDurationDays,
    }
  }

  async startOrganizationTrial(orgLogin: string): Promise<{ message: string; trial: TrialInfo }> {
    const response = await this.request<{
      data: {
        message: string
        trial: {
          status: 'none' | 'active' | 'expired' | 'converted'
          startedAt: string | null
          endsAt: string | null
          convertedAt: string | null
          daysRemaining: number | null
        }
      }
      meta: { requestId: string }
    }>(`/v1/orgs/${orgLogin}/trial/start`, {
      method: 'POST',
    })
    const t = response.data.trial
    return {
      message: response.data.message,
      trial: {
        status: t.status,
        started_at: t.startedAt,
        ends_at: t.endsAt,
        converted_at: t.convertedAt,
        days_remaining: t.daysRemaining,
        trial_duration_days: 15,
      },
    }
  }

  // Organization Connection
  async getAvailableOrganizations(): Promise<AvailableOrgsResponse> {
    const response = await this.request<{
      data: {
        organizations: Array<{
          login: string
          display_name: string
          avatar_url: string
          status: 'ready' | 'needs_install' | 'contact_admin'
          user_role: 'admin' | 'member'
          already_connected: boolean
        }>
        install_url: string
      }
      meta: { requestId: string }
    }>('/v1/github/available-orgs')
    return response.data
  }

  async connectOrganization(orgLogin: string): Promise<ConnectOrgResponse> {
    const response = await this.request<{
      data: {
        organization: {
          id: string
          login: string
          displayName: string
          avatarUrl: string
          plan: 'free' | 'team'
          role: 'owner' | 'member'
          memberCount: number
          vaultCount: number
          stripeCustomerId: string | null
          trial: {
            status: 'none' | 'active' | 'expired' | 'converted'
            startedAt: string | null
            endsAt: string | null
            convertedAt: string | null
            daysRemaining: number | null
          }
          effectivePlan: 'free' | 'team'
          defaultPermissions: Record<string, unknown>
          createdAt: string
          updatedAt: string
          trialDurationDays: number
        }
        message: string
      }
      meta: { requestId: string }
    }>('/v1/orgs/connect', {
      method: 'POST',
      body: JSON.stringify({ orgLogin }),
    })
    const org = response.data.organization
    return {
      organization: {
        id: org.id,
        login: org.login,
        display_name: org.displayName,
        avatar_url: org.avatarUrl,
        plan: org.plan,
        role: org.role,
        member_count: org.memberCount,
        vault_count: org.vaultCount,
        stripe_customer_id: org.stripeCustomerId,
        trial: {
          status: org.trial.status,
          started_at: org.trial.startedAt,
          ends_at: org.trial.endsAt,
          converted_at: org.trial.convertedAt,
          days_remaining: org.trial.daysRemaining,
          trial_duration_days: org.trialDurationDays,
        },
        effective_plan: org.effectivePlan,
        default_permissions: org.defaultPermissions,
        created_at: org.createdAt,
        updated_at: org.updatedAt,
      },
      message: response.data.message,
    }
  }

  // ==========================================================================
  // Exposure methods (secret access tracking for offboarding)
  // ==========================================================================

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
    }>(`/v1/orgs/${orgLogin}/exposure/${username}`)
    return response.data
  }

  // ==========================================================================
  // Provider Sync methods
  // ==========================================================================

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

export const api = new ApiClient()
