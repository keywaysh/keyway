import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VaultDetailHeader, VaultDetailHeaderSkeleton } from '../app/components/dashboard/VaultDetailHeader'
import type { Vault } from '../lib/types'

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ src, alt, ...props }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...props} />
  ),
}))

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const mockVault: Vault = {
  id: 'vault-1',
  repo_id: 'repo-1',
  repo_name: 'my-app',
  repo_owner: 'my-org',
  repo_full_name: 'my-org/my-app',
  repo_avatar: 'https://example.com/avatar.png',
  provider: 'github',
  is_private: false,
  permission: 'admin',
  secrets_count: 10,
  environments: ['default', 'staging', 'production'],
  collaborators_count: 3,
  is_read_only: false,
  readonly_reason: null,
  syncs: [],
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

describe('VaultDetailHeader', () => {
  const mockOnAddSecret = vi.fn()
  const mockOnBulkImport = vi.fn()

  const defaultProps = {
    vault: mockVault,
    isLoading: false,
    canWrite: true,
    userPlan: 'team' as const,
    onAddSecret: mockOnAddSecret,
    onBulkImport: mockOnBulkImport,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Loading State', () => {
    it('should render skeleton when loading', () => {
      render(<VaultDetailHeader {...defaultProps} isLoading={true} />)

      // Skeleton should be present (via the skeleton component's structure)
      const skeleton = document.querySelector('.space-y-2')
      expect(skeleton).toBeInTheDocument()
    })

    it('should not render vault info when loading', () => {
      render(<VaultDetailHeader {...defaultProps} isLoading={true} />)

      expect(screen.queryByText('my-org/my-app')).not.toBeInTheDocument()
    })
  })

  describe('Null Vault State', () => {
    it('should render nothing when vault is undefined', () => {
      const { container } = render(
        <VaultDetailHeader {...defaultProps} vault={undefined} />
      )

      expect(container.firstChild).toBeNull()
    })
  })

  describe('Vault Info Rendering', () => {
    it('should render vault name with owner and repo', () => {
      render(<VaultDetailHeader {...defaultProps} />)

      expect(screen.getByText('my-org/my-app')).toBeInTheDocument()
    })

    it('should render vault avatar with correct src and alt', () => {
      render(<VaultDetailHeader {...defaultProps} />)

      const avatar = screen.getByAltText('my-org')
      expect(avatar).toBeInTheDocument()
      expect(avatar).toHaveAttribute('src', 'https://example.com/avatar.png')
    })

    it('should render secrets count', () => {
      render(<VaultDetailHeader {...defaultProps} />)

      expect(screen.getByText(/10 secrets/)).toBeInTheDocument()
    })

    it('should render environments count', () => {
      render(<VaultDetailHeader {...defaultProps} />)

      expect(screen.getByText(/3 environments/)).toBeInTheDocument()
    })

    it('should render combined stats line', () => {
      render(<VaultDetailHeader {...defaultProps} />)

      expect(screen.getByText('10 secrets · 3 environments')).toBeInTheDocument()
    })
  })

  describe('Add Secrets Dropdown', () => {
    it('should render Add Secrets button when canWrite is true', () => {
      render(<VaultDetailHeader {...defaultProps} canWrite={true} />)

      expect(screen.getByText('Add Secrets')).toBeInTheDocument()
    })

    it('should not render Add Secrets button when canWrite is false', () => {
      render(<VaultDetailHeader {...defaultProps} canWrite={false} />)

      expect(screen.queryByText('Add Secrets')).not.toBeInTheDocument()
    })

    it('should show dropdown options when Add Secrets is clicked', async () => {
      const user = userEvent.setup()
      render(<VaultDetailHeader {...defaultProps} />)

      await user.click(screen.getByText('Add Secrets'))

      expect(await screen.findByText('Add single secret')).toBeInTheDocument()
      expect(await screen.findByText('Import from .env')).toBeInTheDocument()
    })

    it('should call onAddSecret when "Add single secret" is clicked', async () => {
      const user = userEvent.setup()
      render(<VaultDetailHeader {...defaultProps} />)

      await user.click(screen.getByText('Add Secrets'))
      await user.click(await screen.findByText('Add single secret'))

      expect(mockOnAddSecret).toHaveBeenCalledTimes(1)
    })

    it('should call onBulkImport when "Import from .env" is clicked', async () => {
      const user = userEvent.setup()
      render(<VaultDetailHeader {...defaultProps} />)

      await user.click(screen.getByText('Add Secrets'))
      await user.click(await screen.findByText('Import from .env'))

      expect(mockOnBulkImport).toHaveBeenCalledTimes(1)
    })
  })

  describe('Read-Only Banner', () => {
    it('should not show read-only banner when vault is writable', () => {
      render(<VaultDetailHeader {...defaultProps} />)

      expect(screen.queryByText('Read-only vault')).not.toBeInTheDocument()
    })

    it('should show read-only banner when vault.is_read_only is true', () => {
      const readOnlyVault = { ...mockVault, is_read_only: true, readonly_reason: null }
      render(<VaultDetailHeader {...defaultProps} vault={readOnlyVault} />)

      expect(screen.getByText('Read-only vault')).toBeInTheDocument()
    })

    describe('Plan Limit Exceeded', () => {
      it('should show correct message for free plan', () => {
        const readOnlyVault = {
          ...mockVault,
          is_read_only: true,
          readonly_reason: 'plan_limit_exceeded' as const
        }
        render(
          <VaultDetailHeader
            {...defaultProps}
            vault={readOnlyVault}
            userPlan="free"
          />
        )

        expect(screen.getByText(/exceeded your free plan limit of 1 private vault/)).toBeInTheDocument()
        expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument()
      })

      it('should show correct message for pro plan', () => {
        const readOnlyVault = {
          ...mockVault,
          is_read_only: true,
          readonly_reason: 'plan_limit_exceeded' as const
        }
        render(
          <VaultDetailHeader
            {...defaultProps}
            vault={readOnlyVault}
            userPlan="pro"
          />
        )

        expect(screen.getByText(/exceeded your pro plan limit of 5 private vaults/)).toBeInTheDocument()
        expect(screen.getByText('Upgrade to Team')).toBeInTheDocument()
      })

      it('should show correct message for team plan', () => {
        const readOnlyVault = {
          ...mockVault,
          is_read_only: true,
          readonly_reason: 'plan_limit_exceeded' as const
        }
        render(
          <VaultDetailHeader
            {...defaultProps}
            vault={readOnlyVault}
            userPlan="team"
          />
        )

        expect(screen.getByText(/exceeded your team plan limit of 10 private vaults/)).toBeInTheDocument()
        expect(screen.getByText('Upgrade to Startup')).toBeInTheDocument()
      })

      it('should show "Manage subscription" for startup plan (highest tier)', () => {
        const readOnlyVault = {
          ...mockVault,
          is_read_only: true,
          readonly_reason: 'plan_limit_exceeded' as const
        }
        render(
          <VaultDetailHeader
            {...defaultProps}
            vault={readOnlyVault}
            userPlan="startup"
          />
        )

        expect(screen.getByText(/exceeded your startup plan limit of 40 private vaults/)).toBeInTheDocument()
        expect(screen.getByText('Manage subscription')).toBeInTheDocument()
      })

      it('should link to /upgrade for plan limit exceeded', () => {
        const readOnlyVault = {
          ...mockVault,
          is_read_only: true,
          readonly_reason: 'plan_limit_exceeded' as const
        }
        render(<VaultDetailHeader {...defaultProps} vault={readOnlyVault} />)

        const link = screen.getByRole('link', { name: /upgrade/i })
        expect(link).toHaveAttribute('href', '/upgrade')
      })
    })

    describe('Org Free Plan', () => {
      it('should show correct message for org free plan', () => {
        const readOnlyVault = {
          ...mockVault,
          is_read_only: true,
          readonly_reason: 'org_free_plan' as const
        }
        render(<VaultDetailHeader {...defaultProps} vault={readOnlyVault} />)

        expect(screen.getByText(/This organization is on the Free plan/)).toBeInTheDocument()
        expect(screen.getByText('Upgrade organization')).toBeInTheDocument()
      })

      it('should link to org billing page', () => {
        const readOnlyVault = {
          ...mockVault,
          is_read_only: true,
          readonly_reason: 'org_free_plan' as const
        }
        render(<VaultDetailHeader {...defaultProps} vault={readOnlyVault} />)

        const link = screen.getByRole('link', { name: 'Upgrade organization' })
        expect(link).toHaveAttribute('href', '/orgs/my-org/billing')
      })
    })

    describe('Unknown Readonly Reason', () => {
      it('should show generic message for null reason', () => {
        const readOnlyVault = {
          ...mockVault,
          is_read_only: true,
          readonly_reason: null
        }
        render(<VaultDetailHeader {...defaultProps} vault={readOnlyVault} />)

        expect(screen.getByText('This vault is read-only.')).toBeInTheDocument()
        expect(screen.getByText('Learn more')).toBeInTheDocument()
      })
    })
  })
})

describe('VaultDetailHeaderSkeleton', () => {
  it('should render skeleton elements', () => {
    render(<VaultDetailHeaderSkeleton />)

    const container = document.querySelector('.space-y-2')
    expect(container).toBeInTheDocument()

    // Should have 2 skeleton elements (title + subtitle)
    const skeletons = container?.querySelectorAll('[class*="h-"]')
    expect(skeletons?.length).toBe(2)
  })
})
