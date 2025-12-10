import { pgTable, text, integer, timestamp, uuid, pgEnum, decimal, jsonb, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { DEFAULT_ENVIRONMENTS } from '../types';

// Device flow status enum
export const deviceCodeStatusEnum = pgEnum('device_code_status', [
  'pending',
  'approved',
  'denied',
  'expired',
]);

// GitHub collaborator roles (5 levels)
export const collaboratorRoleEnum = pgEnum('collaborator_role', [
  'read',
  'triage',
  'write',
  'maintain',
  'admin',
]);

// Permission types
export const permissionTypeEnum = pgEnum('permission_type', [
  'read',
  'write',
]);

// Activity action types
export const activityActionEnum = pgEnum('activity_action', [
  'vault_created',
  'vault_deleted',
  'secrets_pushed',
  'secrets_pulled',
  'secret_created',
  'secret_updated',
  'secret_deleted',
  'secret_rotated',
  'secret_value_accessed',
  'secret_trashed',
  'secret_restored',
  'secret_permanently_deleted',
  'permission_changed',
  'environment_created',
  'environment_renamed',
  'environment_deleted',
  // Integration actions
  'integration_connected',
  'integration_disconnected',
  'secrets_synced',
  // Billing actions
  'plan_upgraded',
  'plan_downgraded',
  // GitHub App actions
  'github_app_installed',
  'github_app_uninstalled',
  // Auth actions
  'user_login',
]);

// Activity platform types
export const activityPlatformEnum = pgEnum('activity_platform', [
  'cli',
  'web',
  'api',
]);

// Security alert types
export const securityAlertTypeEnum = pgEnum('security_alert_type', [
  'new_device',
  'new_location',
  'impossible_travel',
  'weird_user_agent',
  'rate_anomaly',
]);

// User plan types
export const userPlanEnum = pgEnum('user_plan', [
  'free',
  'pro',
  'team',
]);

// Provider sync status
export const syncStatusEnum = pgEnum('sync_status', [
  'success',
  'failed',
  'partial',
]);

// Provider sync direction
export const syncDirectionEnum = pgEnum('sync_direction', [
  'push',  // Keyway → Provider
  'pull',  // Provider → Keyway
]);

// Billing status types
export const billingStatusEnum = pgEnum('billing_status', [
  'active',
  'past_due',
  'canceled',
  'trialing',
]);

// GitHub App installation account types
export const installationAccountTypeEnum = pgEnum('installation_account_type', [
  'user',
  'organization',
]);

// GitHub App installation status
export const installationStatusEnum = pgEnum('installation_status', [
  'active',
  'suspended',
  'deleted',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  githubId: integer('github_id').notNull().unique(),
  username: text('username').notNull(),
  email: text('email'),
  avatarUrl: text('avatar_url'),
  // Encrypted GitHub access token (AES-256-GCM)
  encryptedAccessToken: text('encrypted_access_token').notNull(),
  accessTokenIv: text('access_token_iv').notNull(),
  accessTokenAuthTag: text('access_token_auth_tag').notNull(),
  tokenEncryptionVersion: integer('token_encryption_version').notNull().default(1),
  // Plan and billing fields
  plan: userPlanEnum('plan').notNull().default('free'),
  billingStatus: billingStatusEnum('billing_status').default('active'),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const vaults = pgTable('vaults', {
  id: uuid('id').primaryKey().defaultRandom(),
  repoFullName: text('repo_full_name').notNull().unique(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  // Whether the GitHub repo is private (fetched from GitHub API during creation)
  isPrivate: boolean('is_private').notNull().default(false),
  // List of environments for this vault (dynamic, user-managed)
  environments: text('environments').array().notNull().default([...DEFAULT_ENVIRONMENTS]),
  // Link to GitHub App installation (for repos using GitHub App access)
  // Note: FK constraint added via migration, references github_app_installations.id
  githubAppInstallationId: uuid('github_app_installation_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Individual secrets (key-value pairs)
export const secrets = pgTable('secrets', {
  id: uuid('id').primaryKey().defaultRandom(),
  vaultId: uuid('vault_id').notNull().references(() => vaults.id, { onDelete: 'cascade' }),
  environment: text('environment').notNull().default('default'),
  key: text('key').notNull(),
  encryptedValue: text('encrypted_value').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  encryptionVersion: integer('encryption_version').notNull().default(1),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  // Soft-delete: null = active, set = trashed (auto-purged after 30 days)
  deletedAt: timestamp('deleted_at'),
});

export const deviceCodes = pgTable('device_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  deviceCode: text('device_code').notNull().unique(),
  userCode: text('user_code').notNull().unique(),
  status: deviceCodeStatusEnum('status').notNull().default('pending'),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  suggestedRepository: text('suggested_repository'), // Optional repo suggested by CLI
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at'),
  // Device/client information for tracking
  deviceId: text('device_id'),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
});

export const environmentPermissions = pgTable('environment_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  vaultId: uuid('vault_id').notNull().references(() => vaults.id, { onDelete: 'cascade' }),
  environment: text('environment').notNull(),
  permissionType: permissionTypeEnum('permission_type').notNull(),
  minRole: collaboratorRoleEnum('min_role').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Activity logs for audit trail (preserved on user/vault deletion for compliance)
export const activityLogs = pgTable('activity_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  vaultId: uuid('vault_id').references(() => vaults.id, { onDelete: 'set null' }),
  action: activityActionEnum('action').notNull(),
  platform: activityPlatformEnum('platform').notNull(),
  metadata: text('metadata'), // JSON string for additional context
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Pull events for security detection (preserved on user/vault deletion for compliance)
export const pullEvents = pgTable('pull_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  vaultId: uuid('vault_id').references(() => vaults.id, { onDelete: 'set null' }),
  deviceId: text('device_id').notNull(),
  ip: text('ip').notNull(),
  userAgent: text('user_agent'),
  country: text('country'),
  city: text('city'),
  latitude: decimal('latitude', { precision: 10, scale: 6 }),
  longitude: decimal('longitude', { precision: 10, scale: 6 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Security alerts (preserved on user/vault deletion for compliance)
export const securityAlerts = pgTable('security_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  vaultId: uuid('vault_id').references(() => vaults.id, { onDelete: 'set null' }),
  deviceId: text('device_id').notNull(),
  alertType: securityAlertTypeEnum('alert_type').notNull(),
  message: text('message').notNull(),
  details: jsonb('details').default({}),
  pullEventId: uuid('pull_event_id').references(() => pullEvents.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Usage metrics (cached/derived data for quick access)
export const usageMetrics = pgTable('usage_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  totalPublicRepos: integer('total_public_repos').notNull().default(0),
  totalPrivateRepos: integer('total_private_repos').notNull().default(0),
  lastComputed: timestamp('last_computed').notNull().defaultNow(),
});

// Provider connections (OAuth tokens for Vercel, Netlify, etc.)
export const providerConnections = pgTable('provider_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // 'vercel', 'netlify', 'railway'
  providerUserId: text('provider_user_id'), // ID of user on provider
  providerTeamId: text('provider_team_id'), // ID of team/org if applicable
  // Encrypted OAuth tokens (AES-256-GCM)
  encryptedAccessToken: text('encrypted_access_token').notNull(),
  accessTokenIv: text('access_token_iv').notNull(),
  accessTokenAuthTag: text('access_token_auth_tag').notNull(),
  accessTokenVersion: integer('access_token_version').notNull().default(1),
  encryptedRefreshToken: text('encrypted_refresh_token'),
  refreshTokenIv: text('refresh_token_iv'),
  refreshTokenAuthTag: text('refresh_token_auth_tag'),
  refreshTokenVersion: integer('refresh_token_version'),
  tokenExpiresAt: timestamp('token_expires_at'),
  scopes: text('scopes').array(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Vault sync configurations (links a vault to a provider project)
export const vaultSyncs = pgTable('vault_syncs', {
  id: uuid('id').primaryKey().defaultRandom(),
  vaultId: uuid('vault_id').notNull().references(() => vaults.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').notNull().references(() => providerConnections.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  providerProjectId: text('provider_project_id').notNull(),
  providerProjectName: text('provider_project_name'), // Human-readable name
  keywayEnvironment: text('keyway_environment').notNull().default('production'),
  providerEnvironment: text('provider_environment').notNull().default('production'),
  autoSync: boolean('auto_sync').notNull().default(false),
  lastSyncedAt: timestamp('last_synced_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Stripe subscriptions
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  stripeSubscriptionId: text('stripe_subscription_id').notNull().unique(),
  stripePriceId: text('stripe_price_id').notNull(),
  status: text('status').notNull(),
  currentPeriodEnd: timestamp('current_period_end').notNull(),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Stripe webhook events for idempotency
export const stripeWebhookEvents = pgTable('stripe_webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  stripeEventId: text('stripe_event_id').notNull().unique(),
  eventType: text('event_type').notNull(),
  processedAt: timestamp('processed_at').notNull().defaultNow(),
});

// GitHub App installations
export const githubAppInstallations = pgTable('github_app_installations', {
  id: uuid('id').primaryKey().defaultRandom(),
  // GitHub App installation identifiers
  installationId: integer('installation_id').notNull().unique(),
  accountId: integer('account_id').notNull(),
  accountLogin: text('account_login').notNull(),
  accountType: installationAccountTypeEnum('account_type').notNull(),
  // Status and permissions
  status: installationStatusEnum('status').notNull().default('active'),
  permissions: jsonb('permissions').notNull().default({}),
  // Repository selection ('all' or 'selected')
  repositorySelection: text('repository_selection').notNull().default('selected'),
  // Tracking who installed it (links to Keyway user if known)
  installedByUserId: uuid('installed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  // Timestamps
  installedAt: timestamp('installed_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  suspendedAt: timestamp('suspended_at'),
  deletedAt: timestamp('deleted_at'),
});

// GitHub App installation repos (junction table for 'selected' repository_selection)
export const githubAppInstallationRepos = pgTable('github_app_installation_repos', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Links to installation (uses internal id, not GitHub's installation_id)
  installationId: uuid('installation_id').notNull().references(() => githubAppInstallations.id, { onDelete: 'cascade' }),
  // GitHub repo identifiers
  repoId: integer('repo_id').notNull(),
  repoFullName: text('repo_full_name').notNull(),
  repoPrivate: boolean('repo_private').notNull().default(false),
  // When the repo was added to this installation
  addedAt: timestamp('added_at').notNull().defaultNow(),
});

// GitHub App installation token cache (1h TTL)
export const githubAppInstallationTokens = pgTable('github_app_installation_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Links to installation (uses internal id)
  installationId: uuid('installation_id').notNull().references(() => githubAppInstallations.id, { onDelete: 'cascade' }).unique(),
  // Encrypted token (same pattern as user tokens)
  encryptedToken: text('encrypted_token').notNull(),
  tokenIv: text('token_iv').notNull(),
  tokenAuthTag: text('token_auth_tag').notNull(),
  tokenEncryptionVersion: integer('token_encryption_version').notNull().default(1),
  // Token expiration (GitHub installation tokens expire in 1 hour)
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Sync logs (audit trail for each sync operation)
export const syncLogs = pgTable('sync_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  syncId: uuid('sync_id').references(() => vaultSyncs.id, { onDelete: 'set null' }),
  vaultId: uuid('vault_id').notNull().references(() => vaults.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  direction: syncDirectionEnum('direction').notNull(),
  status: syncStatusEnum('status').notNull(),
  secretsCreated: integer('secrets_created').notNull().default(0),
  secretsUpdated: integer('secrets_updated').notNull().default(0),
  secretsDeleted: integer('secrets_deleted').notNull().default(0),
  secretsSkipped: integer('secrets_skipped').notNull().default(0),
  error: text('error'),
  triggeredBy: uuid('triggered_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
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
  githubAppInstallations: many(githubAppInstallations),
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
  githubAppInstallation: one(githubAppInstallations, {
    fields: [vaults.githubAppInstallationId],
    references: [githubAppInstallations.id],
  }),
  secrets: many(secrets),
  environmentPermissions: many(environmentPermissions),
  activityLogs: many(activityLogs),
  pullEvents: many(pullEvents),
  securityAlerts: many(securityAlerts),
  vaultSyncs: many(vaultSyncs),
  syncLogs: many(syncLogs),
}));

export const secretsRelations = relations(secrets, ({ one }) => ({
  vault: one(vaults, {
    fields: [secrets.vaultId],
    references: [vaults.id],
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

// GitHub App relations
export const githubAppInstallationsRelations = relations(githubAppInstallations, ({ one, many }) => ({
  installedByUser: one(users, {
    fields: [githubAppInstallations.installedByUserId],
    references: [users.id],
  }),
  repos: many(githubAppInstallationRepos),
  tokenCache: one(githubAppInstallationTokens),
  vaults: many(vaults),
}));

export const githubAppInstallationReposRelations = relations(githubAppInstallationRepos, ({ one }) => ({
  installation: one(githubAppInstallations, {
    fields: [githubAppInstallationRepos.installationId],
    references: [githubAppInstallations.id],
  }),
}));

export const githubAppInstallationTokensRelations = relations(githubAppInstallationTokens, ({ one }) => ({
  installation: one(githubAppInstallations, {
    fields: [githubAppInstallationTokens.installationId],
    references: [githubAppInstallations.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Vault = typeof vaults.$inferSelect;
export type NewVault = typeof vaults.$inferInsert;
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
export type CollaboratorRole = typeof collaboratorRoleEnum.enumValues[number];
export type PermissionType = typeof permissionTypeEnum.enumValues[number];
export type ActivityAction = typeof activityActionEnum.enumValues[number];
export type ActivityPlatform = typeof activityPlatformEnum.enumValues[number];
export type SecurityAlertType = typeof securityAlertTypeEnum.enumValues[number];
export type UserPlan = typeof userPlanEnum.enumValues[number];
export type BillingStatus = typeof billingStatusEnum.enumValues[number];
export type SyncStatus = typeof syncStatusEnum.enumValues[number];
export type SyncDirection = typeof syncDirectionEnum.enumValues[number];
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
export type GithubAppInstallation = typeof githubAppInstallations.$inferSelect;
export type NewGithubAppInstallation = typeof githubAppInstallations.$inferInsert;
export type GithubAppInstallationRepo = typeof githubAppInstallationRepos.$inferSelect;
export type NewGithubAppInstallationRepo = typeof githubAppInstallationRepos.$inferInsert;
export type GithubAppInstallationToken = typeof githubAppInstallationTokens.$inferSelect;
export type NewGithubAppInstallationToken = typeof githubAppInstallationTokens.$inferInsert;
export type InstallationAccountType = typeof installationAccountTypeEnum.enumValues[number];
export type InstallationStatus = typeof installationStatusEnum.enumValues[number];
