import { describe, it, expect } from 'vitest'
import {
  secretSchema,
  secretEditSchema,
  apiKeySchema,
  environmentNameSchema,
} from '../lib/validations'

describe('secretSchema', () => {
  it('should validate a valid secret', () => {
    const result = secretSchema.safeParse({
      name: 'API_KEY',
      value: 'secret-value',
      environments: ['production'],
    })
    expect(result.success).toBe(true)
  })

  it('should require name', () => {
    const result = secretSchema.safeParse({
      name: '',
      value: 'secret-value',
      environments: ['production'],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Name is required')
    }
  })

  it('should require SCREAMING_SNAKE_CASE for name', () => {
    const result = secretSchema.safeParse({
      name: 'api_key',
      value: 'secret-value',
      environments: ['production'],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('SCREAMING_SNAKE_CASE')
    }
  })

  it('should allow numbers in name after first character', () => {
    const result = secretSchema.safeParse({
      name: 'API_KEY_V2',
      value: 'secret-value',
      environments: ['production'],
    })
    expect(result.success).toBe(true)
  })

  it('should reject names starting with number', () => {
    const result = secretSchema.safeParse({
      name: '2FA_SECRET',
      value: 'secret-value',
      environments: ['production'],
    })
    expect(result.success).toBe(false)
  })

  it('should require value', () => {
    const result = secretSchema.safeParse({
      name: 'API_KEY',
      value: '',
      environments: ['production'],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Value is required')
    }
  })

  it('should require at least one environment', () => {
    const result = secretSchema.safeParse({
      name: 'API_KEY',
      value: 'secret-value',
      environments: [],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Select at least one environment')
    }
  })

  it('should allow multiple environments', () => {
    const result = secretSchema.safeParse({
      name: 'API_KEY',
      value: 'secret-value',
      environments: ['production', 'staging', 'development'],
    })
    expect(result.success).toBe(true)
  })

  it('should reject name longer than 255 characters', () => {
    const result = secretSchema.safeParse({
      name: 'A'.repeat(256),
      value: 'secret-value',
      environments: ['production'],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('255')
    }
  })
})

describe('secretEditSchema', () => {
  it('should allow empty value when editing', () => {
    const result = secretEditSchema.safeParse({
      name: 'API_KEY',
      value: '',
      environments: ['production'],
    })
    expect(result.success).toBe(true)
  })

  it('should still require name when editing', () => {
    const result = secretEditSchema.safeParse({
      name: '',
      value: '',
      environments: ['production'],
    })
    expect(result.success).toBe(false)
  })

  it('should still require at least one environment when editing', () => {
    const result = secretEditSchema.safeParse({
      name: 'API_KEY',
      value: 'new-value',
      environments: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('apiKeySchema', () => {
  it('should validate a valid API key creation', () => {
    const result = apiKeySchema.safeParse({
      name: 'CI/CD Production',
      scopes: ['read:secrets', 'write:secrets'],
      expiresInDays: 90,
    })
    expect(result.success).toBe(true)
  })

  it('should require name', () => {
    const result = apiKeySchema.safeParse({
      name: '',
      scopes: ['read:secrets'],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Name is required')
    }
  })

  it('should require at least one scope', () => {
    const result = apiKeySchema.safeParse({
      name: 'My API Key',
      scopes: [],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Select at least one scope')
    }
  })

  it('should allow all valid scopes', () => {
    const result = apiKeySchema.safeParse({
      name: 'Full Access Key',
      scopes: ['read:secrets', 'write:secrets', 'delete:secrets', 'admin:api-keys'],
    })
    expect(result.success).toBe(true)
  })

  it('should reject invalid scopes', () => {
    const result = apiKeySchema.safeParse({
      name: 'My Key',
      scopes: ['invalid:scope'],
    })
    expect(result.success).toBe(false)
  })

  it('should allow expiresInDays to be undefined', () => {
    const result = apiKeySchema.safeParse({
      name: 'Never Expires Key',
      scopes: ['read:secrets'],
    })
    expect(result.success).toBe(true)
  })

  it('should require positive integer for expiresInDays', () => {
    const result = apiKeySchema.safeParse({
      name: 'My Key',
      scopes: ['read:secrets'],
      expiresInDays: -1,
    })
    expect(result.success).toBe(false)
  })

  it('should reject name longer than 100 characters', () => {
    const result = apiKeySchema.safeParse({
      name: 'A'.repeat(101),
      scopes: ['read:secrets'],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('100')
    }
  })
})

describe('environmentNameSchema', () => {
  it('should validate a valid environment name', () => {
    const result = environmentNameSchema.safeParse('production')
    expect(result.success).toBe(true)
  })

  it('should allow hyphens', () => {
    const result = environmentNameSchema.safeParse('staging-1')
    expect(result.success).toBe(true)
  })

  it('should allow underscores', () => {
    const result = environmentNameSchema.safeParse('dev_local')
    expect(result.success).toBe(true)
  })

  it('should reject uppercase letters', () => {
    const result = environmentNameSchema.safeParse('Production')
    expect(result.success).toBe(false)
  })

  it('should reject names starting with number', () => {
    const result = environmentNameSchema.safeParse('1staging')
    expect(result.success).toBe(false)
  })

  it('should reject empty string', () => {
    const result = environmentNameSchema.safeParse('')
    expect(result.success).toBe(false)
  })

  it('should reject names longer than 50 characters', () => {
    const result = environmentNameSchema.safeParse('a'.repeat(51))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('50')
    }
  })
})
