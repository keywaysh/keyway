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

// Error response
export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
