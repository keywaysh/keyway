import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VaultCard, VaultCardSkeleton } from '../app/components/dashboard/VaultCard'
import type { Vault, VaultPermission } from '../lib/types'

// Mock analytics
vi.mock('../lib/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    VAULT_CARD_CLICK: 'vault_card_click',
  },
}))

const mockVault: Vault = {
  id: '1',
  repo_name: 'my-app',
  repo_owner: 'my-org',
  repo_avatar: 'https://example.com/avatar.png',
  environments: ['default', 'production'],
  secrets_count: 10,
  permission: 'admin',
  is_private: false,
  is_read_only: false,
  readonly_reason: null,
  syncs: [],
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
}

describe('VaultCard', () => {
  const mockOnDelete = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render vault name with owner and repo', () => {
      render(<VaultCard vault={mockVault} />)
      expect(screen.getByText('my-org/my-app')).toBeInTheDocument()
    })

    it('should render vault avatar', () => {
      render(<VaultCard vault={mockVault} />)
      const img = screen.getByAltText('my-org')
      expect(img).toBeInTheDocument()
    })

    it('should render secrets count', () => {
      render(<VaultCard vault={mockVault} />)
      expect(screen.getByText('10')).toBeInTheDocument()
      expect(screen.getByText('Secrets')).toBeInTheDocument()
    })

    it('should render environment count', () => {
      render(<VaultCard vault={mockVault} />)
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('Envs')).toBeInTheDocument()
    })

    it('should link to vault detail page', () => {
      render(<VaultCard vault={mockVault} />)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', '/vaults/my-org/my-app')
    })
  })

  describe('read-only warning', () => {
    it('should not show read-only warning by default', () => {
      render(<VaultCard vault={mockVault} />)
      expect(screen.queryByText(/Read-only/)).not.toBeInTheDocument()
    })

    it('should show read-only warning when is_read_only is true', () => {
      const readOnlyVault = { ...mockVault, is_read_only: true, readonly_reason: null }
      render(<VaultCard vault={readOnlyVault} />)
      expect(screen.getByText('Read-only')).toBeInTheDocument()
    })

    it('should show plan limit warning when readonly reason is plan_limit_exceeded', () => {
      const readOnlyVault = { ...mockVault, is_read_only: true, readonly_reason: 'plan_limit_exceeded' as const }
      render(<VaultCard vault={readOnlyVault} />)
      expect(screen.getByText('Read-only · Plan limit')).toBeInTheDocument()
    })

    it('should show org warning when readonly reason is org_free_plan', () => {
      const readOnlyVault = { ...mockVault, is_read_only: true, readonly_reason: 'org_free_plan' as const }
      render(<VaultCard vault={readOnlyVault} />)
      expect(screen.getByText('Read-only · Org on Free')).toBeInTheDocument()
    })
  })

  describe('delete functionality', () => {
    it('should show delete menu for admin permission', () => {
      render(<VaultCard vault={mockVault} onDelete={mockOnDelete} />)
      const menuButton = screen.getByRole('button', { name: /vault actions/i })
      expect(menuButton).toBeInTheDocument()
    })

    it('should not show delete menu for non-admin permission', () => {
      const writeVault = { ...mockVault, permission: 'write' as VaultPermission }
      render(<VaultCard vault={writeVault} onDelete={mockOnDelete} />)
      expect(screen.queryByRole('button', { name: /vault actions/i })).not.toBeInTheDocument()
    })

    it('should not show delete menu when onDelete is not provided', () => {
      render(<VaultCard vault={mockVault} />)
      expect(screen.queryByRole('button', { name: /vault actions/i })).not.toBeInTheDocument()
    })

    // Note: Testing dropdown menu interactions with Radix UI requires additional setup
    // This test verifies the menu button is accessible; actual menu interaction is tested in integration tests
    it('should have accessible menu button for delete action', () => {
      render(<VaultCard vault={mockVault} onDelete={mockOnDelete} />)
      const menuButton = screen.getByRole('button', { name: /vault actions/i })
      expect(menuButton).toHaveAttribute('aria-haspopup', 'menu')
    })
  })

  describe('syncs display', () => {
    it('should not show Active badge when no syncs', () => {
      render(<VaultCard vault={mockVault} />)
      expect(screen.queryByText('Active')).not.toBeInTheDocument()
    })

    it('should show Active badge when vault has syncs', () => {
      const recentSyncDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() // 1 day ago
      const vaultWithSync = {
        ...mockVault,
        syncs: [{ provider: 'vercel', project_name: 'my-project', last_synced_at: recentSyncDate }],
      }
      render(<VaultCard vault={vaultWithSync} />)
      expect(screen.getByText('Active')).toBeInTheDocument()
    })

    it('should show sync provider in subtitle when vault is synced', () => {
      const vaultUpdatedDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() // 2 days ago
      const recentSyncDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() // 1 day ago (after update)
      const vaultWithSync = {
        ...mockVault,
        updated_at: vaultUpdatedDate,
        syncs: [{ provider: 'vercel', project_name: 'my-project', last_synced_at: recentSyncDate }],
      }
      render(<VaultCard vault={vaultWithSync} />)
      expect(screen.getByText('Syncing to Vercel')).toBeInTheDocument()
    })

    it('should show Active badge with multiple sync providers', () => {
      const recentSyncDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() // 1 day ago
      const vaultWithSyncs = {
        ...mockVault,
        syncs: [
          { provider: 'vercel', project_name: 'vercel-project', last_synced_at: recentSyncDate },
          { provider: 'railway', project_name: 'railway-project', last_synced_at: recentSyncDate },
        ],
      }
      render(<VaultCard vault={vaultWithSyncs} />)
      expect(screen.getByText('Active')).toBeInTheDocument()
    })
  })

  describe('time formatting', () => {
    it('should show "just now" for recent updates', () => {
      const vault = { ...mockVault, updated_at: new Date().toISOString() }
      render(<VaultCard vault={vault} />)
      expect(screen.getByText('Updated just now')).toBeInTheDocument()
    })

    it('should show minutes ago', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      const vault = { ...mockVault, updated_at: fiveMinutesAgo }
      render(<VaultCard vault={vault} />)
      expect(screen.getByText('Updated 5m ago')).toBeInTheDocument()
    })

    it('should show hours ago', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      const vault = { ...mockVault, updated_at: twoHoursAgo }
      render(<VaultCard vault={vault} />)
      expect(screen.getByText('Updated 2h ago')).toBeInTheDocument()
    })

    it('should show days ago', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
      const vault = { ...mockVault, updated_at: threeDaysAgo }
      render(<VaultCard vault={vault} />)
      expect(screen.getByText('Updated 3d ago')).toBeInTheDocument()
    })
  })

  describe('stale sync warning', () => {
    it('should show stale text when vault updated after last sync', () => {
      const lastSyncDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() // 2 days ago
      const vaultUpdatedDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() // 1 day ago (after sync)
      const vaultWithStaleSync = {
        ...mockVault,
        updated_at: vaultUpdatedDate,
        syncs: [{ provider: 'vercel', project_name: 'my-project', last_synced_at: lastSyncDate }],
      }
      render(<VaultCard vault={vaultWithStaleSync} />)
      expect(screen.getByText('Sync stale')).toBeInTheDocument()
    })

    it('should not show stale warning when vault synced after last update', () => {
      const vaultUpdatedDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() // 2 days ago
      const lastSyncDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() // 1 day ago (after update)
      const vaultWithFreshSync = {
        ...mockVault,
        updated_at: vaultUpdatedDate,
        syncs: [{ provider: 'vercel', project_name: 'my-project', last_synced_at: lastSyncDate }],
      }
      render(<VaultCard vault={vaultWithFreshSync} />)
      expect(screen.queryByText('Sync stale')).not.toBeInTheDocument()
    })

    it('should show stale text when sync has never synced', () => {
      const vaultWithNeverSynced = {
        ...mockVault,
        syncs: [{ provider: 'vercel', project_name: 'my-project', last_synced_at: null }],
      }
      render(<VaultCard vault={vaultWithNeverSynced} />)
      expect(screen.getByText('Sync stale')).toBeInTheDocument()
    })
  })

  describe('last modified by', () => {
    it('should not show updated by when last_modified_by is not set', () => {
      render(<VaultCard vault={mockVault} />)
      expect(screen.queryByText(/Updated by/)).not.toBeInTheDocument()
    })

    it('should show updated by when last_modified_by is set', () => {
      const vaultWithModifier = { ...mockVault, last_modified_by: 'johndoe' }
      render(<VaultCard vault={vaultWithModifier} />)
      expect(screen.getByText('Updated by johndoe')).toBeInTheDocument()
    })
  })
})

describe('VaultCardSkeleton', () => {
  it('should render skeleton elements', () => {
    const { container } = render(<VaultCardSkeleton />)
    const skeletons = container.querySelectorAll('[class*="animate-pulse"]')
    expect(skeletons.length).toBeGreaterThan(0)
  })
})
