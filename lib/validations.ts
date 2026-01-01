import { z } from 'zod'

// Secret name pattern: SCREAMING_SNAKE_CASE
const SECRET_NAME_REGEX = /^[A-Z][A-Z0-9_]*$/

export const secretSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(255, 'Name must be 255 characters or less')
    .regex(SECRET_NAME_REGEX, 'Must be SCREAMING_SNAKE_CASE (e.g., API_KEY)'),
  value: z
    .string()
    .min(1, 'Value is required'),
  environments: z
    .array(z.string())
    .min(1, 'Select at least one environment'),
})

// For editing secrets, value is optional (empty keeps current value)
export const secretEditSchema = secretSchema.extend({
  value: z.string(), // Can be empty when editing
  environments: z.array(z.string()).min(1), // Still required
})

// API Key creation schema
export const apiKeySchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or less'),
  scopes: z
    .array(z.enum(['read:secrets', 'write:secrets', 'delete:secrets', 'admin:api-keys']))
    .min(1, 'Select at least one scope'),
  expiresInDays: z
    .number()
    .int()
    .positive()
    .optional(),
})

// Environment name schema (for new environments)
export const environmentNameSchema = z
  .string()
  .min(1, 'Environment name is required')
  .max(50, 'Environment name must be 50 characters or less')
  .regex(/^[a-z][a-z0-9-_]*$/, 'Must be lowercase with hyphens or underscores (e.g., prod, staging-1)')

// .env file line parsing
export const envLineSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*=.*$/, 'Invalid format. Expected KEY=value')

// Type exports for use in components
export type SecretFormData = z.infer<typeof secretSchema>
export type SecretEditFormData = z.infer<typeof secretEditSchema>
export type ApiKeyFormData = z.infer<typeof apiKeySchema>
