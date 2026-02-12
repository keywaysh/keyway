import {
  pgTable,
  text,
  integer,
  timestamp,
  uuid,
  pgEnum,
  decimal,
  jsonb,
  boolean,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { DEFAULT_ENVIRONMENTS } from "../types";

// Device flow status enum
export const deviceCodeStatusEnum = pgEnum("device_code_status", [
  "pending",
  "oauth_complete", // OAuth done, waiting for GitHub App install
  "approved",
  "denied",
  "expired",
]);

// GitHub collaborator roles (5 levels)
export const collaboratorRoleEnum = pgEnum("collaborator_role", [
  "read",
  "triage",
  "write",
  "maintain",
  "admin",
]);

// Permission types
export const permissionTypeEnum = pgEnum("permission_type", ["read", "write"]);

// Environment protection types (explicit, stored in vault_environments)
export const environmentTypeEnum = pgEnum("environment_type", [
  "protected", // Production-like: admin-only write, restricted read
  "standard", // Staging/test: normal role-based access
  "development", // Dev/local: permissive access
]);

// Activity action types
export const activityActionEnum = pgEnum("activity_action", [
  "vault_created",
  "vault_deleted",
  "secrets_pushed",
  "secrets_pulled",
  "secret_created",
  "secret_updated",
  "secret_deleted",
  "secret_rotated",
  "secret_value_accessed",
  "secret_trashed",
  "secret_restored",
  "secret_permanently_deleted",
  "secret_version_restored",
  "secret_version_value_accessed",
  "permission_changed",
  "environment_created",
  "environment_renamed",
  "environment_deleted",
  "environment_type_changed",
  // Integration actions
  "integration_connected",
  "integration_disconnected",
  "secrets_synced",
  // Billing actions
  "plan_upgraded",
  "plan_downgraded",
  // VCS App actions (GitHub App, GitLab Integration, etc.)
  "vcs_app_installed",
  "vcs_app_uninstalled",
  // Auth actions
  "user_login",
  // API Key actions
  "api_key_created",
  "api_key_revoked",
  // Trial actions
  "org_trial_started",
  "org_trial_expired",
  "org_trial_converted",
]);

// Activity platform types
export const activityPlatformEnum = pgEnum("activity_platform", ["cli", "web", "api", "mcp"]);

// Security alert types
export const securityAlertTypeEnum = pgEnum("security_alert_type", [
  "new_device",
  "new_location",
  "impossible_travel",
  "weird_user_agent",
  "rate_anomaly",
]);

// User plan types
export const userPlanEnum = pgEnum("user_plan", ["free", "pro", "team", "startup"]);

// Provider sync status
export const syncStatusEnum = pgEnum("sync_status", ["success", "failed", "partial"]);

// Provider sync direction
export const syncDirectionEnum = pgEnum("sync_direction", [
  "push", // Keyway → Provider
  "pull", // Provider → Keyway
]);

// Billing status types
export const billingStatusEnum = pgEnum("billing_status", [
  "active",
  "past_due",
  "canceled",
  "trialing",
]);

// VCS App installation account types
export const installationAccountTypeEnum = pgEnum("installation_account_type", [
  "user",
  "organization",
]);

// VCS App installation status
export const installationStatusEnum = pgEnum("installation_status", [
  "active",
  "suspended",
  "deleted",
]);

// API Key environment type
export const apiKeyEnvironmentEnum = pgEnum("api_key_environment", ["live", "test"]);

// Organization role enum (synced from GitHub org membership)
export const orgRoleEnum = pgEnum("org_role", ["owner", "member"]);

// Permission override target type
export const overrideTargetTypeEnum = pgEnum("override_target_type", ["user", "role"]);

// VCS Forge type (multi-forge support)
export const forgeTypeEnum = pgEnum("forge_type", ["github", "gitlab", "bitbucket"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Multi-forge identity (replaces githubId)
    forgeType: forgeTypeEnum("forge_type").notNull().default("github"),
    forgeUserId: text("forge_user_id").notNull(), // ID as text for all forges
    username: text("username").notNull(),
    email: text("email"),
    avatarUrl: text("avatar_url"),
    // Encrypted VCS access token (AES-256-GCM)
    encryptedAccessToken: text("encrypted_access_token").notNull(),
    accessTokenIv: text("access_token_iv").notNull(),
    accessTokenAuthTag: text("access_token_auth_tag").notNull(),
    tokenEncryptionVersion: integer("token_encryption_version").notNull().default(1),
    // Plan and billing fields
    plan: userPlanEnum("plan").notNull().default("free"),
    billingStatus: billingStatusEnum("billing_status").default("active"),
    stripeCustomerId: text("stripe_customer_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [unique("users_forge_unique").on(table.forgeType, table.forgeUserId)]
);

export const vaults = pgTable(
  "vaults",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Multi-forge support
    forgeType: forgeTypeEnum("forge_type").notNull().default("github"),
    repoFullName: text("repo_full_name").notNull(), // Unique per forge (see constraint below)
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    // Link to organization (for org repos, null for personal repos)
    // Note: FK constraint added via migration to avoid circular reference
    orgId: uuid("org_id"),
    // Whether the repo is private (fetched from VCS API during creation)
    isPrivate: boolean("is_private").notNull().default(false),
    // List of environments for this vault (dynamic, user-managed)
    environments: text("environments")
      .array()
      .notNull()
      .default([...DEFAULT_ENVIRONMENTS]),
    // Link to VCS App installation (for repos using VCS App access)
    // Note: FK constraint added via migration, references vcs_app_installations.id
    vcsAppInstallationId: uuid("vcs_app_installation_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [unique("vaults_forge_repo_unique").on(table.forgeType, table.repoFullName)]
);

// Vault environments with explicit protection type
// This replaces the simple string array in vaults.environments
export const vaultEnvironments = pgTable(
  "vault_environments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Explicit type - not derived from name
    type: environmentTypeEnum("type").notNull().default("standard"),
    // Display order (for UI ordering)
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // Each environment name must be unique within a vault
    unique("vault_environments_vault_name_unique").on(table.vaultId, table.name),
  ]
);

// Individual secrets (key-value pairs)
export const secrets = pgTable("secrets", {
  id: uuid("id").primaryKey().defaultRandom(),
  vaultId: uuid("vault_id")
    .notNull()
    .references(() => vaults.id, { onDelete: "cascade" }),
  environment: text("environment").notNull().default("default"),
  key: text("key").notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  encryptionVersion: integer("encryption_version").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Soft-delete: null = active, set = trashed (auto-purged after 30 days)
  deletedAt: timestamp("deleted_at"),
  // Track who last modified this secret (null for legacy secrets)
  lastModifiedById: uuid("last_modified_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
});

// Secret version history (keeps last 10 versions per secret)
export const secretVersions = pgTable("secret_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  secretId: uuid("secret_id")
    .notNull()
    .references(() => secrets.id, { onDelete: "cascade" }),
  vaultId: uuid("vault_id")
    .notNull()
    .references(() => vaults.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  encryptionVersion: integer("encryption_version").notNull().default(1),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const deviceCodes = pgTable("device_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceCode: text("device_code").notNull().unique(),
  userCode: text("user_code").notNull().unique(),
  status: deviceCodeStatusEnum("status").notNull().default("pending"),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  suggestedRepository: text("suggested_repository"), // Optional repo suggested by CLI
  suggestedOwnerId: integer("suggested_owner_id"), // For deep linking to GitHub App install
  suggestedRepoId: integer("suggested_repo_id"), // For deep linking to GitHub App install
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
  // Device/client information for tracking
  deviceId: text("device_id"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
});

export const environmentPermissions = pgTable("environment_permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  vaultId: uuid("vault_id")
    .notNull()
    .references(() => vaults.id, { onDelete: "cascade" }),
  environment: text("environment").notNull(),
  permissionType: permissionTypeEnum("permission_type").notNull(),
  minRole: collaboratorRoleEnum("min_role").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Activity logs for audit trail (preserved on user/vault deletion for compliance)
export const activityLogs = pgTable("activity_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  vaultId: uuid("vault_id").references(() => vaults.id, { onDelete: "set null" }),
  action: activityActionEnum("action").notNull(),
  platform: activityPlatformEnum("platform").notNull(),
  metadata: text("metadata"), // JSON string for additional context
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Pull events for security detection (preserved on user/vault deletion for compliance)
// source: 'cli' (OAuth user), 'api_key' (PAT/CI), 'mcp' (AI agent)
export const pullEvents = pgTable("pull_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  vaultId: uuid("vault_id").references(() => vaults.id, { onDelete: "set null" }),
  deviceId: text("device_id").notNull(),
  ip: text("ip").notNull(),
  userAgent: text("user_agent"),
  country: text("country"),
  city: text("city"),
  latitude: decimal("latitude", { precision: 10, scale: 6 }),
  longitude: decimal("longitude", { precision: 10, scale: 6 }),
  source: text("source").notNull().default("cli"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Security alerts (preserved on user/vault deletion for compliance)
export const securityAlerts = pgTable("security_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  vaultId: uuid("vault_id").references(() => vaults.id, { onDelete: "set null" }),
  deviceId: text("device_id").notNull(),
  alertType: securityAlertTypeEnum("alert_type").notNull(),
  message: text("message").notNull(),
  details: jsonb("details").default({}),
  pullEventId: uuid("pull_event_id").references(() => pullEvents.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Usage metrics (cached/derived data for quick access)
export const usageMetrics = pgTable("usage_metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  totalPublicRepos: integer("total_public_repos").notNull().default(0),
  totalPrivateRepos: integer("total_private_repos").notNull().default(0),
  lastComputed: timestamp("last_computed").notNull().defaultNow(),
});

// Provider connections (OAuth tokens for Vercel, Netlify, etc.)
export const providerConnections = pgTable("provider_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // 'vercel', 'netlify', 'railway'
  providerUserId: text("provider_user_id"), // ID of user on provider
  providerTeamId: text("provider_team_id"), // ID of team/org if applicable
  // Encrypted OAuth tokens (AES-256-GCM)
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  accessTokenIv: text("access_token_iv").notNull(),
  accessTokenAuthTag: text("access_token_auth_tag").notNull(),
  accessTokenVersion: integer("access_token_version").notNull().default(1),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  refreshTokenIv: text("refresh_token_iv"),
  refreshTokenAuthTag: text("refresh_token_auth_tag"),
  refreshTokenVersion: integer("refresh_token_version"),
  tokenExpiresAt: timestamp("token_expires_at"),
  scopes: text("scopes").array(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Vault sync configurations (links a vault to a provider project)
export const vaultSyncs = pgTable("vault_syncs", {
  id: uuid("id").primaryKey().defaultRandom(),
  vaultId: uuid("vault_id")
    .notNull()
    .references(() => vaults.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id")
    .notNull()
    .references(() => providerConnections.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerProjectId: text("provider_project_id").notNull(),
  providerProjectName: text("provider_project_name"), // Human-readable name
  keywayEnvironment: text("keyway_environment").notNull().default("production"),
  providerEnvironment: text("provider_environment").notNull().default("production"),
  autoSync: boolean("auto_sync").notNull().default(false),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Stripe subscriptions
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
  stripePriceId: text("stripe_price_id").notNull(),
  status: text("status").notNull(),
  currentPeriodEnd: timestamp("current_period_end").notNull(),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Stripe webhook events for idempotency
export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  stripeEventId: text("stripe_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
});

// GitHub App installations
export const vcsAppInstallations = pgTable(
  "vcs_app_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Multi-forge support
    forgeType: forgeTypeEnum("forge_type").notNull().default("github"),
    // VCS App installation identifiers
    installationId: integer("installation_id").notNull(),
    accountId: integer("account_id").notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: installationAccountTypeEnum("account_type").notNull(),
    // Status and permissions
    status: installationStatusEnum("status").notNull().default("active"),
    permissions: jsonb("permissions").notNull().default({}),
    // Repository selection ('all' or 'selected')
    repositorySelection: text("repository_selection").notNull().default("selected"),
    // Tracking who installed it (links to Keyway user if known)
    installedByUserId: uuid("installed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Timestamps
    installedAt: timestamp("installed_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    suspendedAt: timestamp("suspended_at"),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    unique("vcs_app_installations_forge_unique").on(table.forgeType, table.installationId),
  ]
);

// VCS App installation repos (junction table for 'selected' repository_selection)
export const vcsAppInstallationRepos = pgTable("vcs_app_installation_repos", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Links to installation (uses internal id, not VCS's installation_id)
  installationId: uuid("installation_id")
    .notNull()
    .references(() => vcsAppInstallations.id, { onDelete: "cascade" }),
  // GitHub repo identifiers
  repoId: integer("repo_id").notNull(),
  repoFullName: text("repo_full_name").notNull(),
  repoPrivate: boolean("repo_private").notNull().default(false),
  // When the repo was added to this installation
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

// VCS App installation token cache (1h TTL)
export const vcsAppInstallationTokens = pgTable("vcs_app_installation_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Links to installation (uses internal id)
  installationId: uuid("installation_id")
    .notNull()
    .references(() => vcsAppInstallations.id, { onDelete: "cascade" })
    .unique(),
  // Encrypted token (same pattern as user tokens)
  encryptedToken: text("encrypted_token").notNull(),
  tokenIv: text("token_iv").notNull(),
  tokenAuthTag: text("token_auth_tag").notNull(),
  tokenEncryptionVersion: integer("token_encryption_version").notNull().default(1),
  // Token expiration (VCS installation tokens expire in 1 hour)
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// API Keys for programmatic access
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // Human-readable name ("CI/CD Production", "Local dev")
  // Token stored as hash only (SHA-256), never in clear text
  keyPrefix: text("key_prefix").notNull(), // "kw_live_a1b2c3d4" for display
  keyHash: text("key_hash").notNull().unique(), // SHA-256 of full token
  // Metadata
  environment: apiKeyEnvironmentEnum("environment").notNull(), // 'live' | 'test'
  scopes: text("scopes").array().notNull().default([]), // ['read:secrets', 'write:secrets']
  // Limits
  expiresAt: timestamp("expires_at"), // NULL = never expires
  lastUsedAt: timestamp("last_used_at"),
  usageCount: integer("usage_count").notNull().default(0),
  // Audit
  createdAt: timestamp("created_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
  revokedReason: text("revoked_reason"), // 'manual' | 'github_leak' | 'expired'
  // Security
  allowedIps: text("allowed_ips").array(), // CIDR notation, NULL = all IPs allowed
  createdFromIp: text("created_from_ip"),
  createdUserAgent: text("created_user_agent"),
});

// Sync logs (audit trail for each sync operation)
export const syncLogs = pgTable("sync_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  syncId: uuid("sync_id").references(() => vaultSyncs.id, { onDelete: "set null" }),
  vaultId: uuid("vault_id")
    .notNull()
    .references(() => vaults.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  direction: syncDirectionEnum("direction").notNull(),
  status: syncStatusEnum("status").notNull(),
  secretsCreated: integer("secrets_created").notNull().default(0),
  secretsUpdated: integer("secrets_updated").notNull().default(0),
  secretsDeleted: integer("secrets_deleted").notNull().default(0),
  secretsSkipped: integer("secrets_skipped").notNull().default(0),
  error: text("error"),
  triggeredBy: uuid("triggered_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Organizations table (GitHub organizations)
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Multi-forge organization identifiers (replaces githubOrgId)
    forgeType: forgeTypeEnum("forge_type").notNull().default("github"),
    forgeOrgId: text("forge_org_id").notNull(), // ID as text for all forges
    login: text("login").notNull(), // Unique per forge (see constraint below)
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    // Billing (per-org for Team plan)
    plan: userPlanEnum("plan").notNull().default("free"),
    stripeCustomerId: text("stripe_customer_id"),
    // Trial period (for Team plan - 15 days free trial)
    trialStartedAt: timestamp("trial_started_at"),
    trialEndsAt: timestamp("trial_ends_at"),
    trialConvertedAt: timestamp("trial_converted_at"),
    // Default permissions for this org (can override global defaults)
    // Structure: { [role]: { [envType]: { read: boolean, write: boolean } } }
    defaultPermissions: jsonb("default_permissions").default({}),
    // Timestamps
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [unique("organizations_forge_unique").on(table.forgeType, table.forgeOrgId)]
);

// Organization members (junction table between orgs and users)
export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Role in the organization (synced from VCS)
    orgRole: orgRoleEnum("org_role").notNull().default("member"),
    // VCS membership state
    membershipState: text("membership_state").default("active"),
    // Timestamps
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [unique("organization_members_org_user_unique").on(table.orgId, table.userId)]
);

// Permission overrides (per-vault, per-environment)
// Allows org owners or repo admins to override default permissions for specific users or roles
export const permissionOverrides = pgTable(
  "permission_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    // Environment name or '*' for all environments
    environment: text("environment").notNull(),
    // Target type: either a specific user OR a GitHub role
    targetType: overrideTargetTypeEnum("target_type").notNull(),
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "cascade" }),
    targetRole: collaboratorRoleEnum("target_role"),
    // Permissions granted
    canRead: boolean("can_read").notNull().default(true),
    canWrite: boolean("can_write").notNull().default(false),
    // Audit
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // Ensure unique override per vault/env/target combination
    unique("permission_overrides_unique").on(
      table.vaultId,
      table.environment,
      table.targetType,
      table.targetUserId,
      table.targetRole
    ),
  ]
);

// Secret accesses for Exposure feature (tracking who accessed which secrets)
// Enables offboarding: "Dev leaves? You know exactly what to rotate."
export const secretAccesses = pgTable("secret_accesses", {
  id: uuid("id").primaryKey().defaultRandom(),
  // User (snapshot fields for survival after user deletion)
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  username: text("username").notNull(),
  userAvatarUrl: text("user_avatar_url"),
  // Secret (snapshot fields for survival after secret deletion)
  secretId: uuid("secret_id").references(() => secrets.id, { onDelete: "set null" }),
  secretKey: text("secret_key").notNull(),
  // Vault (snapshot fields for survival after vault deletion)
  vaultId: uuid("vault_id").references(() => vaults.id, { onDelete: "set null" }),
  repoFullName: text("repo_full_name").notNull(),
  environment: text("environment").notNull(),
  // Context at time of access
  githubRole: collaboratorRoleEnum("github_role").notNull(),
  platform: activityPlatformEnum("platform").notNull(),
  ipAddress: text("ip_address"),
  deviceId: text("device_id"),
  // Timestamps
  firstAccessedAt: timestamp("first_accessed_at").notNull().defaultNow(),
  lastAccessedAt: timestamp("last_accessed_at").notNull().defaultNow(),
  accessCount: integer("access_count").notNull().default(1),
  // Link to pull event for forensics
  pullEventId: uuid("pull_event_id").references(() => pullEvents.id, { onDelete: "set null" }),
});

// Relations
export const usersRelations = relations(users, ({ many, one }) => ({
  vaults: many(vaults),
  deviceCodes: many(deviceCodes),
  refreshTokens: many(refreshTokens),
  activityLogs: many(activityLogs),
  pullEvents: many(pullEvents),
  securityAlerts: many(securityAlerts),
  usageMetrics: one(usageMetrics),
  providerConnections: many(providerConnections),
  subscription: one(subscriptions),
  vcsAppInstallations: many(vcsAppInstallations),
  apiKeys: many(apiKeys),
  organizationMemberships: many(organizationMembers),
  secretAccesses: many(secretAccesses),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, {
    fields: [subscriptions.userId],
    references: [users.id],
  }),
}));

export const usageMetricsRelations = relations(usageMetrics, ({ one }) => ({
  user: one(users, {
    fields: [usageMetrics.userId],
    references: [users.id],
  }),
}));

export const vaultsRelations = relations(vaults, ({ one, many }) => ({
  owner: one(users, {
    fields: [vaults.ownerId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [vaults.orgId],
    references: [organizations.id],
  }),
  vcsAppInstallation: one(vcsAppInstallations, {
    fields: [vaults.vcsAppInstallationId],
    references: [vcsAppInstallations.id],
  }),
  secrets: many(secrets),
  vaultEnvironments: many(vaultEnvironments),
  environmentPermissions: many(environmentPermissions),
  permissionOverrides: many(permissionOverrides),
  activityLogs: many(activityLogs),
  pullEvents: many(pullEvents),
  securityAlerts: many(securityAlerts),
  vaultSyncs: many(vaultSyncs),
  syncLogs: many(syncLogs),
  secretAccesses: many(secretAccesses),
}));

export const vaultEnvironmentsRelations = relations(vaultEnvironments, ({ one }) => ({
  vault: one(vaults, {
    fields: [vaultEnvironments.vaultId],
    references: [vaults.id],
  }),
}));

export const secretsRelations = relations(secrets, ({ one, many }) => ({
  vault: one(vaults, {
    fields: [secrets.vaultId],
    references: [vaults.id],
  }),
  lastModifiedBy: one(users, {
    fields: [secrets.lastModifiedById],
    references: [users.id],
  }),
  versions: many(secretVersions),
  accesses: many(secretAccesses),
}));

export const secretVersionsRelations = relations(secretVersions, ({ one }) => ({
  secret: one(secrets, {
    fields: [secretVersions.secretId],
    references: [secrets.id],
  }),
  vault: one(vaults, {
    fields: [secretVersions.vaultId],
    references: [vaults.id],
  }),
  createdBy: one(users, {
    fields: [secretVersions.createdById],
    references: [users.id],
  }),
}));

export const deviceCodesRelations = relations(deviceCodes, ({ one }) => ({
  user: one(users, {
    fields: [deviceCodes.userId],
    references: [users.id],
  }),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}));

export const environmentPermissionsRelations = relations(environmentPermissions, ({ one }) => ({
  vault: one(vaults, {
    fields: [environmentPermissions.vaultId],
    references: [vaults.id],
  }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  user: one(users, {
    fields: [activityLogs.userId],
    references: [users.id],
  }),
  vault: one(vaults, {
    fields: [activityLogs.vaultId],
    references: [vaults.id],
  }),
}));

export const pullEventsRelations = relations(pullEvents, ({ one, many }) => ({
  user: one(users, {
    fields: [pullEvents.userId],
    references: [users.id],
  }),
  vault: one(vaults, {
    fields: [pullEvents.vaultId],
    references: [vaults.id],
  }),
  securityAlerts: many(securityAlerts),
  secretAccesses: many(secretAccesses),
}));

export const secretAccessesRelations = relations(secretAccesses, ({ one }) => ({
  user: one(users, {
    fields: [secretAccesses.userId],
    references: [users.id],
  }),
  secret: one(secrets, {
    fields: [secretAccesses.secretId],
    references: [secrets.id],
  }),
  vault: one(vaults, {
    fields: [secretAccesses.vaultId],
    references: [vaults.id],
  }),
  pullEvent: one(pullEvents, {
    fields: [secretAccesses.pullEventId],
    references: [pullEvents.id],
  }),
}));

export const securityAlertsRelations = relations(securityAlerts, ({ one }) => ({
  user: one(users, {
    fields: [securityAlerts.userId],
    references: [users.id],
  }),
  vault: one(vaults, {
    fields: [securityAlerts.vaultId],
    references: [vaults.id],
  }),
  pullEvent: one(pullEvents, {
    fields: [securityAlerts.pullEventId],
    references: [pullEvents.id],
  }),
}));

export const providerConnectionsRelations = relations(providerConnections, ({ one, many }) => ({
  user: one(users, {
    fields: [providerConnections.userId],
    references: [users.id],
  }),
  vaultSyncs: many(vaultSyncs),
}));

export const vaultSyncsRelations = relations(vaultSyncs, ({ one, many }) => ({
  vault: one(vaults, {
    fields: [vaultSyncs.vaultId],
    references: [vaults.id],
  }),
  connection: one(providerConnections, {
    fields: [vaultSyncs.connectionId],
    references: [providerConnections.id],
  }),
  syncLogs: many(syncLogs),
}));

export const syncLogsRelations = relations(syncLogs, ({ one }) => ({
  sync: one(vaultSyncs, {
    fields: [syncLogs.syncId],
    references: [vaultSyncs.id],
  }),
  vault: one(vaults, {
    fields: [syncLogs.vaultId],
    references: [vaults.id],
  }),
  triggeredByUser: one(users, {
    fields: [syncLogs.triggeredBy],
    references: [users.id],
  }),
}));

// VCS App relations
export const vcsAppInstallationsRelations = relations(vcsAppInstallations, ({ one, many }) => ({
  installedByUser: one(users, {
    fields: [vcsAppInstallations.installedByUserId],
    references: [users.id],
  }),
  repos: many(vcsAppInstallationRepos),
  tokenCache: one(vcsAppInstallationTokens),
  vaults: many(vaults),
}));

export const vcsAppInstallationReposRelations = relations(vcsAppInstallationRepos, ({ one }) => ({
  installation: one(vcsAppInstallations, {
    fields: [vcsAppInstallationRepos.installationId],
    references: [vcsAppInstallations.id],
  }),
}));

export const vcsAppInstallationTokensRelations = relations(vcsAppInstallationTokens, ({ one }) => ({
  installation: one(vcsAppInstallations, {
    fields: [vcsAppInstallationTokens.installationId],
    references: [vcsAppInstallations.id],
  }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

// Organization relations
export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
  vaults: many(vaults),
}));

export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationMembers.orgId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [organizationMembers.userId],
    references: [users.id],
  }),
}));

export const permissionOverridesRelations = relations(permissionOverrides, ({ one }) => ({
  vault: one(vaults, {
    fields: [permissionOverrides.vaultId],
    references: [vaults.id],
  }),
  targetUser: one(users, {
    fields: [permissionOverrides.targetUserId],
    references: [users.id],
  }),
  createdByUser: one(users, {
    fields: [permissionOverrides.createdBy],
    references: [users.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Vault = typeof vaults.$inferSelect;
export type NewVault = typeof vaults.$inferInsert;
export type VaultEnvironment = typeof vaultEnvironments.$inferSelect;
export type NewVaultEnvironment = typeof vaultEnvironments.$inferInsert;
export type EnvironmentType = (typeof environmentTypeEnum.enumValues)[number];
export type Secret = typeof secrets.$inferSelect;
export type NewSecret = typeof secrets.$inferInsert;
export type DeviceCode = typeof deviceCodes.$inferSelect;
export type NewDeviceCode = typeof deviceCodes.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
export type EnvironmentPermission = typeof environmentPermissions.$inferSelect;
export type NewEnvironmentPermission = typeof environmentPermissions.$inferInsert;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type NewActivityLog = typeof activityLogs.$inferInsert;
export type PullEvent = typeof pullEvents.$inferSelect;
export type NewPullEvent = typeof pullEvents.$inferInsert;
export type SecurityAlert = typeof securityAlerts.$inferSelect;
export type NewSecurityAlert = typeof securityAlerts.$inferInsert;
export type UsageMetric = typeof usageMetrics.$inferSelect;
export type NewUsageMetric = typeof usageMetrics.$inferInsert;
export type CollaboratorRole = (typeof collaboratorRoleEnum.enumValues)[number];
export type PermissionType = (typeof permissionTypeEnum.enumValues)[number];
export type ActivityAction = (typeof activityActionEnum.enumValues)[number];
export type ActivityPlatform = (typeof activityPlatformEnum.enumValues)[number];
export type SecurityAlertType = (typeof securityAlertTypeEnum.enumValues)[number];
export type UserPlan = (typeof userPlanEnum.enumValues)[number];
export type BillingStatus = (typeof billingStatusEnum.enumValues)[number];
export type SyncStatus = (typeof syncStatusEnum.enumValues)[number];
export type SyncDirection = (typeof syncDirectionEnum.enumValues)[number];
export type ProviderConnection = typeof providerConnections.$inferSelect;
export type NewProviderConnection = typeof providerConnections.$inferInsert;
export type VaultSync = typeof vaultSyncs.$inferSelect;
export type NewVaultSync = typeof vaultSyncs.$inferInsert;
export type SyncLog = typeof syncLogs.$inferSelect;
export type NewSyncLog = typeof syncLogs.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;
export type NewStripeWebhookEvent = typeof stripeWebhookEvents.$inferInsert;
export type VcsAppInstallation = typeof vcsAppInstallations.$inferSelect;
export type NewVcsAppInstallation = typeof vcsAppInstallations.$inferInsert;
export type VcsAppInstallationRepo = typeof vcsAppInstallationRepos.$inferSelect;
export type NewVcsAppInstallationRepo = typeof vcsAppInstallationRepos.$inferInsert;
export type VcsAppInstallationToken = typeof vcsAppInstallationTokens.$inferSelect;
export type NewVcsAppInstallationToken = typeof vcsAppInstallationTokens.$inferInsert;
export type ForgeType = (typeof forgeTypeEnum.enumValues)[number];
export type InstallationAccountType = (typeof installationAccountTypeEnum.enumValues)[number];
export type InstallationStatus = (typeof installationStatusEnum.enumValues)[number];
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type ApiKeyEnvironment = (typeof apiKeyEnvironmentEnum.enumValues)[number];
export type SecretVersion = typeof secretVersions.$inferSelect;
export type NewSecretVersion = typeof secretVersions.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;
export type PermissionOverride = typeof permissionOverrides.$inferSelect;
export type NewPermissionOverride = typeof permissionOverrides.$inferInsert;
export type OrgRole = (typeof orgRoleEnum.enumValues)[number];
export type OverrideTargetType = (typeof overrideTargetTypeEnum.enumValues)[number];
export type SecretAccess = typeof secretAccesses.$inferSelect;
export type NewSecretAccess = typeof secretAccesses.$inferInsert;
