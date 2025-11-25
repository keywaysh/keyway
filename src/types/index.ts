import { z } from 'zod';

// User schemas
export const UserSchema = z.object({
  id: z.string(),
  githubId: z.number(),
  username: z.string(),
  email: z.string().email().nullable(),
  avatarUrl: z.string().nullable(),
  accessToken: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type User = z.infer<typeof UserSchema>;

// Vault schemas
export const VaultSchema = z.object({
  id: z.string(),
  repoFullName: z.string(),
  ownerId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Vault = z.infer<typeof VaultSchema>;

// Secret schemas
export const SecretSchema = z.object({
  id: z.string(),
  vaultId: z.string(),
  environment: z.string(),
  encryptedContent: z.string(),
  iv: z.string(),
  authTag: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Secret = z.infer<typeof SecretSchema>;

// API Request/Response schemas
export const InitVaultRequestSchema = z.object({
  repoFullName: z.string().regex(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/),
});

export type InitVaultRequest = z.infer<typeof InitVaultRequestSchema>;

export const InitVaultResponseSchema = z.object({
  vaultId: z.string(),
  repoFullName: z.string(),
  message: z.string(),
});

export type InitVaultResponse = z.infer<typeof InitVaultResponseSchema>;

// Body schema for push (only content comes from body)
export const PushSecretsBodySchema = z.object({
  content: z.string(),
});

export type PushSecretsBody = z.infer<typeof PushSecretsBodySchema>;

// Full request schema (for internal use after combining params + body)
export const PushSecretsRequestSchema = z.object({
  repoFullName: z.string().regex(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/),
  environment: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  content: z.string(),
});

export type PushSecretsRequest = z.infer<typeof PushSecretsRequestSchema>;

export const PushSecretsResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type PushSecretsResponse = z.infer<typeof PushSecretsResponseSchema>;

export const PullSecretsResponseSchema = z.object({
  content: z.string(),
});

export type PullSecretsResponse = z.infer<typeof PullSecretsResponseSchema>;

export const GitHubCallbackRequestSchema = z.object({
  code: z.string(),
});

export type GitHubCallbackRequest = z.infer<typeof GitHubCallbackRequestSchema>;

export const GitHubCallbackResponseSchema = z.object({
  accessToken: z.string(),
  user: z.object({
    id: z.number(),
    username: z.string(),
    email: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  }),
});

export type GitHubCallbackResponse = z.infer<typeof GitHubCallbackResponseSchema>;

// Device Flow schemas
export const DeviceFlowStartRequestSchema = z.object({
  repository: z.string().regex(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/).optional(),
});

export type DeviceFlowStartRequest = z.infer<typeof DeviceFlowStartRequestSchema>;

export const DeviceFlowStartResponseSchema = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUri: z.string(),
  verificationUriComplete: z.string(),
  expiresIn: z.number(),
  interval: z.number(),
});

export type DeviceFlowStartResponse = z.infer<typeof DeviceFlowStartResponseSchema>;

export const DeviceFlowPollRequestSchema = z.object({
  deviceCode: z.string(),
});

export type DeviceFlowPollRequest = z.infer<typeof DeviceFlowPollRequestSchema>;

export const DeviceFlowPollResponsePendingSchema = z.object({
  status: z.literal('pending'),
});

export const DeviceFlowPollResponseApprovedSchema = z.object({
  status: z.literal('approved'),
  keywayToken: z.string(),
  githubLogin: z.string(),
  expiresAt: z.string(),
});

export const DeviceFlowPollResponseExpiredSchema = z.object({
  status: z.literal('expired'),
  message: z.string(),
});

export const DeviceFlowPollResponseDeniedSchema = z.object({
  status: z.literal('denied'),
  message: z.string(),
});

export type DeviceFlowPollResponsePending = z.infer<typeof DeviceFlowPollResponsePendingSchema>;
export type DeviceFlowPollResponseApproved = z.infer<typeof DeviceFlowPollResponseApprovedSchema>;
export type DeviceFlowPollResponseExpired = z.infer<typeof DeviceFlowPollResponseExpiredSchema>;
export type DeviceFlowPollResponseDenied = z.infer<typeof DeviceFlowPollResponseDeniedSchema>;

export type DeviceFlowPollResponse =
  | DeviceFlowPollResponsePending
  | DeviceFlowPollResponseApproved
  | DeviceFlowPollResponseExpired
  | DeviceFlowPollResponseDenied;

// Error response
export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ============================================
// Dashboard API Types
// ============================================

// GET /api/me - User profile response
export const UserProfileResponseSchema = z.object({
  id: z.string().uuid().nullable(), // null if user hasn't created any vault yet
  githubId: z.number(),
  username: z.string(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  createdAt: z.string().nullable(), // null if user not in DB yet
});

export type UserProfileResponse = z.infer<typeof UserProfileResponseSchema>;

// GET /api/vaults - Vault list item
export const VaultListItemSchema = z.object({
  id: z.string().uuid(),
  repoOwner: z.string(),
  repoName: z.string(),
  repoAvatar: z.string().nullable(),
  secretCount: z.number(),
  environments: z.array(z.string()),
  updatedAt: z.string(),
});

export type VaultListItem = z.infer<typeof VaultListItemSchema>;

export const VaultListResponseSchema = z.object({
  vaults: z.array(VaultListItemSchema),
  total: z.number(),
});

export type VaultListResponse = z.infer<typeof VaultListResponseSchema>;

// GET /api/vaults/:vaultId - Single vault metadata
export const VaultMetadataResponseSchema = z.object({
  id: z.string().uuid(),
  repoFullName: z.string(),
  repoOwner: z.string(),
  repoName: z.string(),
  repoAvatar: z.string().nullable(),
  secretCount: z.number(),
  environments: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type VaultMetadataResponse = z.infer<typeof VaultMetadataResponseSchema>;

// GET /api/vaults/:vaultId/secrets - Secret list item (no value)
export const SecretListItemSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  environment: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SecretListItem = z.infer<typeof SecretListItemSchema>;

export const SecretListResponseSchema = z.object({
  secrets: z.array(SecretListItemSchema),
  total: z.number(),
});

export type SecretListResponse = z.infer<typeof SecretListResponseSchema>;

// POST /api/vaults/:vaultId/secrets - Upsert secret request
export const UpsertSecretRequestSchema = z.object({
  key: z.string().min(1).max(255).regex(/^[A-Z][A-Z0-9_]*$/, {
    message: 'Key must be uppercase with underscores (e.g., DATABASE_URL)',
  }),
  value: z.string(),
  environment: z.string().min(1).max(50).default('default'),
});

export type UpsertSecretRequest = z.infer<typeof UpsertSecretRequestSchema>;

export const UpsertSecretResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['created', 'updated']),
});

export type UpsertSecretResponse = z.infer<typeof UpsertSecretResponseSchema>;

// GET /api/activity - Activity log item
export const ActivityLogItemSchema = z.object({
  id: z.string().uuid(),
  action: z.enum([
    'vault_created',
    'secrets_pushed',
    'secrets_pulled',
    'secret_created',
    'secret_updated',
    'secret_deleted',
    'secret_rotated',
    'permission_changed',
  ]),
  vaultId: z.string().uuid().nullable(),
  repoFullName: z.string().nullable(),
  actor: z.object({
    id: z.string().uuid(),
    username: z.string(),
    avatarUrl: z.string().nullable(),
  }),
  platform: z.enum(['cli', 'web', 'api']),
  metadata: z.record(z.unknown()).nullable(),
  timestamp: z.string(),
});

export type ActivityLogItem = z.infer<typeof ActivityLogItemSchema>;

export const ActivityLogResponseSchema = z.object({
  activities: z.array(ActivityLogItemSchema),
  total: z.number(),
});

export type ActivityLogResponse = z.infer<typeof ActivityLogResponseSchema>;

// Vault ID param schema
export const VaultIdParamSchema = z.object({
  vaultId: z.string().uuid(),
});

export type VaultIdParam = z.infer<typeof VaultIdParamSchema>;

// Vault and Secret ID param schema
export const VaultSecretIdParamSchema = z.object({
  vaultId: z.string().uuid(),
  secretId: z.string().uuid(),
});

export type VaultSecretIdParam = z.infer<typeof VaultSecretIdParamSchema>;

// Repo and environment param schema
export const RepoEnvParamSchema = z.object({
  repo: z.string(),
  env: z.string(),
});

export type RepoEnvParam = z.infer<typeof RepoEnvParamSchema>;

// Repo param schema
export const RepoParamSchema = z.object({
  repo: z.string(),
});

export type RepoParam = z.infer<typeof RepoParamSchema>;

// Environment permission body schema
export const EnvironmentPermissionBodySchema = z.object({
  permissions: z.object({
    read: z.enum(['read', 'triage', 'write', 'maintain', 'admin']),
    write: z.enum(['read', 'triage', 'write', 'maintain', 'admin']),
  }),
});

export type EnvironmentPermissionBody = z.infer<typeof EnvironmentPermissionBodySchema>;
