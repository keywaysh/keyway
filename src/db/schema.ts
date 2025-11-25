import { pgTable, text, integer, timestamp, uuid, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

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
  'permission_changed',
]);

// Activity platform types
export const activityPlatformEnum = pgEnum('activity_platform', [
  'cli',
  'web',
  'api',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  githubId: integer('github_id').notNull().unique(),
  username: text('username').notNull(),
  email: text('email'),
  avatarUrl: text('avatar_url'),
  accessToken: text('access_token').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const vaults = pgTable('vaults', {
  id: uuid('id').primaryKey().defaultRandom(),
  repoFullName: text('repo_full_name').notNull().unique(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
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
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
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

export const environmentPermissions = pgTable('environment_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  vaultId: uuid('vault_id').notNull().references(() => vaults.id, { onDelete: 'cascade' }),
  environment: text('environment').notNull(),
  permissionType: permissionTypeEnum('permission_type').notNull(),
  minRole: collaboratorRoleEnum('min_role').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Activity logs for audit trail
export const activityLogs = pgTable('activity_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  vaultId: uuid('vault_id').references(() => vaults.id, { onDelete: 'set null' }),
  action: activityActionEnum('action').notNull(),
  platform: activityPlatformEnum('platform').notNull(),
  metadata: text('metadata'), // JSON string for additional context
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  vaults: many(vaults),
  deviceCodes: many(deviceCodes),
  activityLogs: many(activityLogs),
}));

export const vaultsRelations = relations(vaults, ({ one, many }) => ({
  owner: one(users, {
    fields: [vaults.ownerId],
    references: [users.id],
  }),
  secrets: many(secrets),
  environmentPermissions: many(environmentPermissions),
  activityLogs: many(activityLogs),
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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Vault = typeof vaults.$inferSelect;
export type NewVault = typeof vaults.$inferInsert;
export type Secret = typeof secrets.$inferSelect;
export type NewSecret = typeof secrets.$inferInsert;
export type DeviceCode = typeof deviceCodes.$inferSelect;
export type NewDeviceCode = typeof deviceCodes.$inferInsert;
export type EnvironmentPermission = typeof environmentPermissions.$inferSelect;
export type NewEnvironmentPermission = typeof environmentPermissions.$inferInsert;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type NewActivityLog = typeof activityLogs.$inferInsert;
export type CollaboratorRole = typeof collaboratorRoleEnum.enumValues[number];
export type PermissionType = typeof permissionTypeEnum.enumValues[number];
export type ActivityAction = typeof activityActionEnum.enumValues[number];
export type ActivityPlatform = typeof activityPlatformEnum.enumValues[number];
