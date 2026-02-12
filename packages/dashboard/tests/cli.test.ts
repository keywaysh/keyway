import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { detectPlatform, CLI_INSTALL, CLI_COMMANDS, CLI_NPX, CLI_DOCS_URL } from '../lib/cli'

describe('cli', () => {
  describe('CLI_INSTALL', () => {
    it('should have mac install command', () => {
      expect(CLI_INSTALL.mac.command).toBe('brew install keywaysh/tap/keyway')
      expect(CLI_INSTALL.mac.copyable).toBe(true)
    })

    it('should have linux install command', () => {
      expect(CLI_INSTALL.linux.command).toBe('curl -fsSL https://keyway.sh/install.sh | sh')
      expect(CLI_INSTALL.linux.copyable).toBe(true)
    })

    it('should have windows install command', () => {
      expect(CLI_INSTALL.windows.command).toBe('Download for Windows')
      expect(CLI_INSTALL.windows.copyable).toBe(false)
      expect(CLI_INSTALL.windows.href).toBe('https://github.com/keywaysh/cli/releases/latest')
    })
  })

  describe('CLI_COMMANDS', () => {
    it('should have correct commands', () => {
      expect(CLI_COMMANDS.init).toBe('keyway init')
      expect(CLI_COMMANDS.pull).toBe('keyway pull')
      expect(CLI_COMMANDS.sync).toBe('keyway sync')
      expect(CLI_COMMANDS.run).toBe('keyway run -- npm start')
    })
  })

  describe('CLI_NPX', () => {
    it('should have correct npx commands', () => {
      expect(CLI_NPX.base).toBe('npx @keywaysh/cli')
      expect(CLI_NPX.init).toBe('npx @keywaysh/cli init')
      expect(CLI_NPX.pull).toBe('npx @keywaysh/cli pull')
      expect(CLI_NPX.sync).toBe('npx @keywaysh/cli sync')
    })
  })

  describe('CLI_DOCS_URL', () => {
    it('should have correct docs URL', () => {
      expect(CLI_DOCS_URL).toBe('https://docs.keyway.sh/installation')
    })
  })

  describe('detectPlatform', () => {
    // Note: In jsdom environment, window is always defined, so we can only test platform detection
    it('should return a valid platform in browser environment', () => {
      const platform = detectPlatform()
      expect(['mac', 'linux', 'windows']).toContain(platform)
    })
  })
})
