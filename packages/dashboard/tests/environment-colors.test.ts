import { describe, it, expect } from 'vitest'
import { environmentColors, getEnvironmentColor } from '../lib/environment-colors'

describe('environment-colors', () => {
  describe('environmentColors', () => {
    it('should have local environment colors', () => {
      expect(environmentColors.local).toBeDefined()
      expect(environmentColors.local.bg).toBe('bg-slate-500/15')
      expect(environmentColors.local.border).toBe('border-slate-500/30')
      expect(environmentColors.local.text).toBe('text-slate-600 dark:text-slate-400')
    })

    it('should have development environment colors', () => {
      expect(environmentColors.development).toBeDefined()
      expect(environmentColors.development.bg).toBe('bg-blue-500/15')
    })

    it('should have staging environment colors', () => {
      expect(environmentColors.staging).toBeDefined()
      expect(environmentColors.staging.bg).toBe('bg-amber-500/15')
    })

    it('should have production environment colors', () => {
      expect(environmentColors.production).toBeDefined()
      expect(environmentColors.production.bg).toBe('bg-emerald-500/15')
    })
  })

  describe('getEnvironmentColor', () => {
    it('should return correct colors for local', () => {
      const colors = getEnvironmentColor('local')
      expect(colors.bg).toBe('bg-slate-500/15')
      expect(colors.border).toBe('border-slate-500/30')
      expect(colors.text).toBe('text-slate-600 dark:text-slate-400')
    })

    it('should return correct colors for development', () => {
      const colors = getEnvironmentColor('development')
      expect(colors.bg).toBe('bg-blue-500/15')
    })

    it('should return correct colors for staging', () => {
      const colors = getEnvironmentColor('staging')
      expect(colors.bg).toBe('bg-amber-500/15')
    })

    it('should return correct colors for production', () => {
      const colors = getEnvironmentColor('production')
      expect(colors.bg).toBe('bg-emerald-500/15')
    })

    it('should return fallback colors for unknown environments', () => {
      const colors = getEnvironmentColor('unknown-env')
      expect(colors.bg).toBe('bg-purple-500/15')
      expect(colors.border).toBe('border-purple-500/30')
      expect(colors.text).toBe('text-purple-600 dark:text-purple-400')
    })

    it('should return fallback colors for empty string', () => {
      const colors = getEnvironmentColor('')
      expect(colors.bg).toBe('bg-purple-500/15')
    })

    it('should return fallback colors for custom environment', () => {
      const colors = getEnvironmentColor('my-custom-env')
      expect(colors.bg).toBe('bg-purple-500/15')
    })
  })
})
