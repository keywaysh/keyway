import { z } from 'zod';

// ============================================
// Shared Constants
// ============================================

// Default environments for new vaults
// Maps to common .env file conventions: .env -> development, .env.staging -> staging, etc.
export const DEFAULT_ENVIRONMENTS = ['local', 'development', 'staging', 'production'] as const;

// ============================================
// Shared Validation Patterns
// ============================================

// GitHub allows: alphanumeric, hyphens, underscores, and dots in org/repo names
// Pattern: owner/repo where both parts allow a-z, A-Z, 0-9, -, _, .
export const REPO_FULL_NAME_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
export const ENVIRONMENT_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

// Reusable Zod schemas for validation
export const repoFullNameSchema = z.string().regex(REPO_FULL_NAME_PATTERN, {
  message: 'Invalid repository format. Expected: owner/repo',
});

export const environmentNameSchema = z.string().regex(ENVIRONMENT_NAME_PATTERN, {
  message: 'Invalid environment name. Only alphanumeric, hyphens, underscores, and dots allowed.',
});

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
  repoFullName: repoFullNameSchema,
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
  repoFullName: repoFullNameSchema,
  environment: environmentNameSchema,
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
  repository: repoFullNameSchema.optional(),
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

// Permission levels (matches CollaboratorRole)
export const PermissionLevelSchema = z.enum(['read', 'triage', 'write', 'maintain', 'admin']);
export type PermissionLevel = z.infer<typeof PermissionLevelSchema>;

// GET /api/vaults - Vault list item
export const VaultListItemSchema = z.object({
  id: z.string().uuid(),
  repoOwner: z.string(),
  repoName: z.string(),
  repoAvatar: z.string().nullable(),
  secretCount: z.number(),
  environments: z.array(z.string()),
  permission: PermissionLevelSchema.nullable(),
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
  permission: PermissionLevelSchema.nullable(),
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

// PATCH /api/vaults/:owner/:repo/secrets/:secretId - Partial update
export const PatchSecretRequestSchema = z.object({
  name: z.string().min(1).max(255).regex(/^[A-Z][A-Z0-9_]*$/, {
    message: 'Key must be uppercase with underscores (e.g., DATABASE_URL)',
  }).optional(),
  value: z.string().optional(),
}).refine(data => data.name !== undefined || data.value !== undefined, {
  message: 'At least one of name or value must be provided',
});

export type PatchSecretRequest = z.infer<typeof PatchSecretRequestSchema>;

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

// Pagination query params
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

// Pagination meta for responses
export const PaginationMetaSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
});

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

export const ActivityLogResponseSchema = z.object({
  activities: z.array(ActivityLogItemSchema),
  total: z.number(),
  meta: PaginationMetaSchema.optional(),
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
