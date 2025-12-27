import { describe, it, expect } from 'vitest'

/**
 * Coverage indicator logic tests
 * Tests the functions that calculate incomplete secrets
 */

// Recreate the coverage calculation logic from the page component
function groupSecretsByName(secrets: { name: string; environment: string }[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const secret of secrets) {
    if (!map.has(secret.name)) map.set(secret.name, new Set())
    map.get(secret.name)!.add(secret.environment)
  }
  return map
}

function countSecretsByEnv(secrets: { name: string; environment: string }[], allEnvironments: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const env of allEnvironments) {
    counts[env] = secrets.filter(s => s.environment === env).length
  }
  return counts
}

function findIncompleteSecrets(
  secretsByName: Map<string, Set<string>>,
  allEnvironments: string[],
  secretsByEnv: Record<string, number>
): { name: string; missingIn: string[] }[] {
  // Only consider environments that have at least one secret
  const activeEnvironments = allEnvironments.filter(env => secretsByEnv[env] > 0)
  if (activeEnvironments.length <= 1) return [] // Need at least 2 envs to compare

  const result: { name: string; missingIn: string[] }[] = []
  Array.from(secretsByName.entries()).forEach(([name, envs]) => {
    const missing = activeEnvironments.filter(env => !envs.has(env))
    if (missing.length > 0 && missing.length < activeEnvironments.length) {
      // Only show if partially present (not missing everywhere)
      result.push({ name, missingIn: missing })
    }
  })
  return result.sort((a, b) => b.missingIn.length - a.missingIn.length)
}

describe('Coverage Indicators', () => {
  const DEFAULT_ENVIRONMENTS = ['local', 'development', 'staging', 'production']

  describe('groupSecretsByName', () => {
    it('should group secrets by name', () => {
      const secrets = [
        { name: 'API_KEY', environment: 'development' },
        { name: 'API_KEY', environment: 'production' },
        { name: 'DB_URL', environment: 'development' },
      ]

      const result = groupSecretsByName(secrets)

      expect(result.size).toBe(2)
      expect(result.get('API_KEY')).toEqual(new Set(['development', 'production']))
      expect(result.get('DB_URL')).toEqual(new Set(['development']))
    })

    it('should handle empty secrets array', () => {
      const result = groupSecretsByName([])
      expect(result.size).toBe(0)
    })

    it('should handle single secret in single environment', () => {
      const secrets = [{ name: 'SECRET', environment: 'production' }]
      const result = groupSecretsByName(secrets)

      expect(result.size).toBe(1)
      expect(result.get('SECRET')).toEqual(new Set(['production']))
    })
  })

  describe('findIncompleteSecrets', () => {
    it('should return empty array when all secrets are in all active environments', () => {
      const secrets = [
        { name: 'API_KEY', environment: 'development' },
        { name: 'API_KEY', environment: 'production' },
        { name: 'DB_URL', environment: 'development' },
        { name: 'DB_URL', environment: 'production' },
      ]
      const allEnvs = ['development', 'production']
      const secretsByName = groupSecretsByName(secrets)
      const secretsByEnv = countSecretsByEnv(secrets, allEnvs)

      const result = findIncompleteSecrets(secretsByName, allEnvs, secretsByEnv)

      expect(result).toHaveLength(0)
    })

    it('should find secrets missing in some active environments', () => {
      const secrets = [
        { name: 'API_KEY', environment: 'development' },
        { name: 'API_KEY', environment: 'production' },
        { name: 'DB_URL', environment: 'development' }, // missing in production
      ]
      const allEnvs = ['development', 'production']
      const secretsByName = groupSecretsByName(secrets)
      const secretsByEnv = countSecretsByEnv(secrets, allEnvs)

      const result = findIncompleteSecrets(secretsByName, allEnvs, secretsByEnv)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('DB_URL')
      expect(result[0].missingIn).toEqual(['production'])
    })

    it('should ignore empty environments (no secrets)', () => {
      const secrets = [
        { name: 'API_KEY', environment: 'development' },
        { name: 'API_KEY', environment: 'production' },
        // staging has 0 secrets - should be ignored
      ]
      const allEnvs = ['development', 'staging', 'production']
      const secretsByName = groupSecretsByName(secrets)
      const secretsByEnv = countSecretsByEnv(secrets, allEnvs)

      const result = findIncompleteSecrets(secretsByName, allEnvs, secretsByEnv)

      // API_KEY is in all active envs (dev, prod), staging is empty so ignored
      expect(result).toHaveLength(0)
    })

    it('should sort by number of missing environments (most critical first)', () => {
      const secrets = [
        { name: 'API_KEY', environment: 'development' },
        { name: 'API_KEY', environment: 'staging' },
        { name: 'API_KEY', environment: 'production' },
        { name: 'DB_URL', environment: 'development' }, // missing in staging, production (2)
        { name: 'DEBUG_KEY', environment: 'development' },
        { name: 'DEBUG_KEY', environment: 'staging' }, // missing in production (1)
      ]
      const allEnvs = ['development', 'staging', 'production']
      const secretsByName = groupSecretsByName(secrets)
      const secretsByEnv = countSecretsByEnv(secrets, allEnvs)

      const result = findIncompleteSecrets(secretsByName, allEnvs, secretsByEnv)

      expect(result).toHaveLength(2)
      // DB_URL should be first (missing in 2 envs)
      expect(result[0].name).toBe('DB_URL')
      expect(result[0].missingIn).toEqual(['staging', 'production'])
      // DEBUG_KEY should be second (missing in 1 env)
      expect(result[1].name).toBe('DEBUG_KEY')
      expect(result[1].missingIn).toEqual(['production'])
    })

    it('should handle secrets present in all active environments', () => {
      const secrets = [
        { name: 'API_KEY', environment: 'development' },
        { name: 'API_KEY', environment: 'staging' },
        { name: 'API_KEY', environment: 'production' },
        // local has 0 secrets - should be ignored
      ]
      const secretsByName = groupSecretsByName(secrets)
      const secretsByEnv = countSecretsByEnv(secrets, DEFAULT_ENVIRONMENTS)

      const result = findIncompleteSecrets(secretsByName, DEFAULT_ENVIRONMENTS, secretsByEnv)

      // API_KEY is in all active environments
      expect(result).toHaveLength(0)
    })

    it('should correctly identify multiple incomplete secrets across active environments', () => {
      const secrets = [
        { name: 'API_KEY', environment: 'development' },
        { name: 'API_KEY', environment: 'production' },
        { name: 'DB_URL', environment: 'development' }, // missing in production
        { name: 'WEBHOOK_SECRET', environment: 'production' }, // missing in development
      ]
      const allEnvs = ['development', 'production']
      const secretsByName = groupSecretsByName(secrets)
      const secretsByEnv = countSecretsByEnv(secrets, allEnvs)

      const result = findIncompleteSecrets(secretsByName, allEnvs, secretsByEnv)

      expect(result).toHaveLength(2)
      const names = result.map(r => r.name)
      expect(names).toContain('DB_URL')
      expect(names).toContain('WEBHOOK_SECRET')
    })

    it('should return empty when only one active environment', () => {
      const secrets = [
        { name: 'API_KEY', environment: 'production' },
        { name: 'DB_URL', environment: 'production' },
      ]
      const allEnvs = ['development', 'production'] // development is empty
      const secretsByName = groupSecretsByName(secrets)
      const secretsByEnv = countSecretsByEnv(secrets, allEnvs)

      const result = findIncompleteSecrets(secretsByName, allEnvs, secretsByEnv)

      // Only production is active, can't compare with just one env
      expect(result).toHaveLength(0)
    })

    it('should handle case where secret is in only one environment out of multiple active', () => {
      const secrets = [
        { name: 'SHARED_KEY', environment: 'development' },
        { name: 'SHARED_KEY', environment: 'staging' },
        { name: 'SHARED_KEY', environment: 'production' },
        { name: 'PROD_ONLY_KEY', environment: 'production' }, // missing in dev, staging
      ]
      const allEnvs = ['development', 'staging', 'production']
      const secretsByName = groupSecretsByName(secrets)
      const secretsByEnv = countSecretsByEnv(secrets, allEnvs)

      const result = findIncompleteSecrets(secretsByName, allEnvs, secretsByEnv)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('PROD_ONLY_KEY')
      expect(result[0].missingIn).toEqual(['development', 'staging'])
    })

    it('should handle empty environments list', () => {
      const secrets = [{ name: 'API_KEY', environment: 'production' }]
      const secretsByName = groupSecretsByName(secrets)
      const secretsByEnv = countSecretsByEnv(secrets, [])

      const result = findIncompleteSecrets(secretsByName, [], secretsByEnv)

      expect(result).toHaveLength(0)
    })
  })
})
