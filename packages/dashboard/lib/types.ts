export type UserPlan = 'free' | 'pro' | 'team' | 'startup'

export type ReadonlyReason = 'plan_limit_exceeded' | 'org_free_plan' | null

export interface User {
  id: string
  name: string
  email: string
  avatar_url: string
  github_username: string
  plan: UserPlan
  created_at: string | null
}

// Maps to GitHub repository roles
export type VaultPermission = 'admin' | 'maintain' | 'write' | 'triage' | 'read'

export interface VaultSync {
  id: string
  provider: string
  project_id: string
  project_name: string | null
  connection_id: string
  keyway_environment: string
  provider_environment: string
  last_synced_at: string | null
}

export interface SyncPreview {
  toCreate: string[]
  toUpdate: string[]
  toDelete: string[]
  toSkip: string[]
}

export interface SyncResult {
  status: 'success' | 'partial' | 'error'
  created: number
  updated: number
  deleted: number
  skipped: number
  error?: string
}

export interface Vault {
  id: string
  repo_name: string
  repo_owner: string
  repo_avatar: string
  environments: string[]
  secrets_count: number
  permission: VaultPermission
  is_private: boolean
  is_read_only: boolean
  readonly_reason: ReadonlyReason
  syncs: VaultSync[]
  updated_at: string
  created_at: string
  last_modified_by?: string
}

export interface Secret {
  id: string
  name: string
  environment: string
  created_at: string
  updated_at: string
  last_modified_by: {
    username: string
    avatar_url: string | null
  } | null
}

export interface TrashedSecret {
  id: string
  name: string
  environment: string
  deleted_at: string
  expires_at: string
  days_remaining: number
}

export interface SecretVersion {
  id: string
  version_number: number
  created_at: string
  created_by: {
    username: string
    avatar_url: string | null
  } | null
}

export type ActivityAction =
  | 'vault_created'
  | 'vault_deleted'
  | 'secrets_pushed'
  | 'secrets_pulled'
  | 'secret_created'
  | 'secret_updated'
  | 'secret_deleted'
  | 'secret_rotated'
  | 'secret_value_accessed'
  | 'secret_trashed'
  | 'secret_restored'
  | 'secret_permanently_deleted'
  | 'secret_version_restored'
  | 'secret_version_value_accessed'
  | 'permission_changed'
  | 'environment_created'
  | 'environment_renamed'
  | 'environment_deleted'
  // Integration actions
  | 'integration_connected'
  | 'integration_disconnected'
  | 'secrets_synced'
  // Billing actions
  | 'plan_upgraded'
  | 'plan_downgraded'
  // GitHub App actions
  | 'github_app_installed'
  | 'github_app_uninstalled'
  // Auth actions
  | 'user_login'
  // API Key actions
  | 'api_key_created'
  | 'api_key_revoked'

export type ActivityCategory = 'all' | 'secrets' | 'vaults' | 'environments' | 'access' | 'integrations' | 'billing' | 'account'

export interface ActivityEvent {
  id: string
  action: ActivityAction
  category: ActivityCategory
  vault_id: string
  vault_name: string
  user_name: string
  user_avatar: string
  platform: 'cli' | 'web' | 'api'
  timestamp: string
  // Metadata for display
  secret_name?: string
  environment?: string
  count?: number
}

// Collaborator represents a GitHub collaborator with their permission level
export interface Collaborator {
  login: string
  avatarUrl: string
  htmlUrl: string
  permission: VaultPermission
}

// API Keys
export type ApiKeyEnvironment = 'live' | 'test'
export type ApiKeyScope = 'read:secrets' | 'write:secrets' | 'delete:secrets' | 'admin:api-keys'

export interface ApiKey {
  id: string
  name: string
  prefix: string
  environment: ApiKeyEnvironment
  scopes: ApiKeyScope[]
  expiresAt: string | null
  lastUsedAt: string | null
  usageCount: number
  createdAt: string
  revokedAt: string | null
  revokedReason: string | null
  isActive: boolean
}

export interface CreateApiKeyRequest {
  name: string
  environment: ApiKeyEnvironment
  scopes: ApiKeyScope[]
  expiresInDays?: number
  allowedIps?: string[]
}

export interface CreateApiKeyResponse extends ApiKey {
  token: string // Only returned once on creation
}

// Organization types
export type OrganizationPlan = 'free' | 'team'
export type OrganizationRole = 'owner' | 'member'
export type TrialStatus = 'none' | 'active' | 'expired' | 'converted'

export interface Organization {
  id: string
  login: string
  display_name: string
  avatar_url: string
  plan: OrganizationPlan
  role: OrganizationRole
  member_count: number
  vault_count: number
  created_at: string
}

export interface OrganizationMember {
  id: string
  username: string
  avatar_url: string
  role: OrganizationRole
  joined_at: string
}

export interface TrialInfo {
  status: TrialStatus
  started_at: string | null
  ends_at: string | null
  converted_at: string | null
  days_remaining: number | null
  trial_duration_days: number
}

export interface OrganizationDetails extends Organization {
  stripe_customer_id: string | null
  trial: TrialInfo
  effective_plan: OrganizationPlan
  default_permissions: Record<string, unknown>
  updated_at: string
}

export interface OrganizationBillingStatus {
  plan: OrganizationPlan
  effective_plan: OrganizationPlan
  billing_status: 'active' | 'past_due' | 'canceled' | 'trialing' | null
  stripe_customer_id: string | null
  subscription: {
    id: string
    status: string
    current_period_end: string
    cancel_at_period_end: boolean
  } | null
  trial: TrialInfo
  prices: {
    monthly: { id: string; price: number; interval: string }
    yearly: { id: string; price: number; interval: string }
  } | null
}

export interface SyncMembersResult {
  message: string
  added: number
  updated: number
  removed: number
}

// Exposure types (secret access tracking for offboarding)
export interface ExposureUserSummary {
  user: {
    id: string | null
    username: string
    avatarUrl: string | null
  }
  secretsAccessed: number
  vaultsAccessed: number
  lastAccess: string
}

export interface ExposureSecretDetail {
  secretId: string | null
  key: string
  environment: string
  roleAtAccess: VaultPermission
  firstAccess: string
  lastAccess: string
  accessCount: number
}

export interface ExposureVaultGroup {
  vaultId: string | null
  repoFullName: string
  secrets: ExposureSecretDetail[]
}

export interface ExposureUserReport {
  user: {
    id: string | null
    username: string
    avatarUrl: string | null
  }
  summary: {
    totalSecretsAccessed: number
    totalVaultsAccessed: number
    firstAccess: string | null
    lastAccess: string | null
  }
  vaults: ExposureVaultGroup[]
}

export interface ExposureOrgSummary {
  summary: {
    users: number
    secrets: number
    accesses: number
  }
  users: ExposureUserSummary[]
}

// Available GitHub organizations for connection
export type AvailableOrgStatus = 'ready' | 'needs_install' | 'contact_admin'

export interface AvailableOrg {
  login: string
  display_name: string
  avatar_url: string
  status: AvailableOrgStatus
  user_role: 'admin' | 'member'
  already_connected: boolean
}

export interface AvailableOrgsResponse {
  organizations: AvailableOrg[]
  install_url: string
}

export interface ConnectOrgResponse {
  organization: OrganizationDetails
  message: string
}

// Security Alert types
export type SecurityAlertType =
  | 'new_device'
  | 'new_location'
  | 'impossible_travel'
  | 'weird_user_agent'
  | 'rate_anomaly'

export interface SecurityAlert {
  id: string
  type: SecurityAlertType
  message: string
  createdAt: string
  vault: { repoFullName: string } | null
  event: {
    ip: string
    location: { country: string | null; city: string | null }
    deviceId: string
  } | null
}

// Security Center types
export interface SecurityOverview {
  alerts: {
    total: number
    critical: number
    warning: number
    last7Days: number
    last30Days: number
  }
  access: {
    uniqueUsers: number
    totalPulls: number
    last7Days: number
    topVaults: Array<{ repoFullName: string; pullCount: number }>
    topUsers: Array<{ username: string; avatarUrl: string | null; pullCount: number }>
  }
  exposure: {
    usersWithAccess: number
    secretsAccessed: number
    lastAccessAt: string | null
  }
}

export type AccessLogAction = 'pull' | 'view' | 'view_version'

export interface AccessLogEvent {
  id: string
  timestamp: string
  action: AccessLogAction
  user: { username: string; avatarUrl: string | null } | null
  vault: { repoFullName: string } | null
  ip: string
  location: { country: string | null; city: string | null }
  deviceId: string
  hasAlert: boolean
  metadata?: {
    secretKey?: string
    environment?: string
    platform?: string
  }
}

export interface AccessLogResponse {
  events: AccessLogEvent[]
  total: number
}

