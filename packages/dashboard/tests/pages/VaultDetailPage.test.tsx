import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VaultDetailPage from '../../app/(dashboard)/vaults/[owner]/[repo]/page'
import type { Vault, Secret, TrashedSecret } from '../../lib/types'

// Mock next/navigation
const mockParams = { owner: 'testowner', repo: 'testrepo' }
vi.mock('next/navigation', () => ({
  useParams: () => mockParams,
}))

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ src, alt, ...props }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...props} />
  ),
}))

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock auth
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
      avatar_url: 'https://example.com/avatar.png',
      github_username: 'testuser',
      plan: 'team',
    },
    isLoading: false,
  }),
}))

// Mock analytics
vi.mock('../../lib/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    VAULT_DETAIL_VIEW: 'vault_detail_view',
    VAULT_SEARCH: 'vault_search',
    ENVIRONMENT_FILTER: 'environment_filter',
    SECRET_MODAL_OPEN: 'secret_modal_open',
    SECRET_CREATE: 'secret_create',
    SECRET_EDIT: 'secret_edit',
    SECRET_DELETE: 'secret_delete',
    SECRET_COPY_TO_ENV: 'secret_copy_to_env',
  },
}))

// Mock date-utils
vi.mock('../../lib/date-utils', () => ({
  formatLastSynced: (date: string | null) => date ? 'Just now' : 'Never',
}))

// Mock environment-colors
vi.mock('../../lib/environment-colors', () => ({
  getEnvironmentColor: (env: string) => ({
    text: 'text-green-500',
    bg: 'bg-green-500/10',
    border: 'border-green-500/20',
  }),
}))

// Mock TanStack Query
const mockQueryClient = {
  invalidateQueries: vi.fn(),
  setQueryData: vi.fn(),
}

const mockVault: Vault = {
  id: 'vault-1',
  repo_id: 'repo-1',
  repo_name: 'testrepo',
  repo_owner: 'testowner',
  repo_full_name: 'testowner/testrepo',
  repo_avatar: 'https://avatar.example.com/testowner.png',
  provider: 'github',
  is_private: false,
  permission: 'admin',
  secrets_count: 3,
  environments: ['default', 'staging', 'production'],
  collaborators_count: 2,
  is_read_only: false,
  readonly_reason: null,
  syncs: [],
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

const mockSecrets: Secret[] = [
  {
    id: 'secret-1',
    name: 'API_KEY',
    environment: 'production',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'secret-2',
    name: 'DATABASE_URL',
    environment: 'production',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'secret-3',
    name: 'API_KEY',
    environment: 'staging',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
]

const mockTrashedSecrets: TrashedSecret[] = []

let mockVaultLoading = false
let mockSecretsLoading = false
let mockTrashLoading = false
let mockVaultError: Error | null = null
let mockSecretsError: Error | null = null

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'vault') {
      return {
        data: mockVaultLoading ? undefined : mockVault,
        isLoading: mockVaultLoading,
        error: mockVaultError,
      }
    }
    if (queryKey[0] === 'secrets') {
      return {
        data: mockSecretsLoading ? undefined : mockSecrets,
        isLoading: mockSecretsLoading,
        error: mockSecretsError,
        refetch: vi.fn(),
      }
    }
    if (queryKey[0] === 'trash') {
      return {
        data: mockTrashLoading ? undefined : mockTrashedSecrets,
        isLoading: mockTrashLoading,
      }
    }
    return { data: undefined, isLoading: false, error: null }
  },
  useMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isLoading: false,
  }),
  useQueryClient: () => mockQueryClient,
}))

// Mock API
vi.mock('../../lib/api', () => ({
  api: {
    getVaultByRepo: vi.fn(),
    getSecretsByRepo: vi.fn(),
    getTrashedSecrets: vi.fn(),
    createSecretByRepo: vi.fn(),
    updateSecretByRepo: vi.fn(),
    deleteSecretByRepo: vi.fn(),
    restoreSecret: vi.fn(),
    permanentlyDeleteSecret: vi.fn(),
    emptyTrash: vi.fn(),
    getSecretValue: vi.fn(),
  },
}))

// Mock dashboard components
vi.mock('../../app/components/dashboard', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div data-testid="dashboard-layout">{children}</div>,
  VaultDetailHeader: ({ vault, isLoading, canWrite, onAddSecret, onBulkImport }: {
    vault: Vault | undefined
    isLoading: boolean
    canWrite: boolean
    userPlan: string
    onAddSecret: () => void
    onBulkImport: () => void
  }) => {
    if (isLoading) {
      return <div data-testid="vault-header-skeleton" />
    }
    if (!vault) {
      return null
    }
    return (
      <div data-testid="vault-header">
        <img src={vault.repo_avatar} alt={vault.repo_owner} />
        <span>{vault.repo_owner}/{vault.repo_name}</span>
        <span>{vault.secrets_count} secrets · {vault.environments.length} environments</span>
        {canWrite && (
          <div>
            <button>Add Secrets</button>
            <button onClick={onAddSecret}>Add single secret</button>
            <button onClick={onBulkImport}>Import from .env</button>
          </div>
        )}
      </div>
    )
  },
  SecretRow: ({ secret, onView, onEdit, onDelete }: { secret: Secret; onView?: (s: Secret) => void; onEdit?: (s: Secret) => void; onDelete?: (s: Secret) => void }) => (
    <div data-testid={`secret-row-${secret.id}`}>
      <span>{secret.name}</span>
      <span>{secret.environment}</span>
      {onView && <button onClick={() => onView(secret)}>View</button>}
      {onEdit && <button onClick={() => onEdit(secret)}>Edit</button>}
      {onDelete && <button onClick={() => onDelete(secret)}>Delete</button>}
    </div>
  ),
  SecretRowSkeleton: () => <div data-testid="secret-row-skeleton" />,
  SecretModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? <div data-testid="secret-modal"><button onClick={onClose}>Close</button></div> : null,
  ViewSecretModal: ({ isOpen, onClose, secret }: { isOpen: boolean; onClose: () => void; secret: Secret | null }) =>
    isOpen ? <div data-testid="view-secret-modal">{secret?.name}<button onClick={onClose}>Close</button></div> : null,
  BulkImportModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? <div data-testid="bulk-import-modal"><button onClick={onClose}>Close</button></div> : null,
  ErrorState: ({ message, onRetry }: { message: string; onRetry: () => void }) => (
    <div data-testid="error-state">
      <span>{message}</span>
      <button onClick={onRetry}>Retry</button>
    </div>
  ),
  EmptyState: ({ title, message, action }: { title: string; message: string; action?: React.ReactNode }) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      <p>{message}</p>
      {action}
    </div>
  ),
  TrashSection: ({ trashedSecrets }: { trashedSecrets: TrashedSecret[] }) => (
    <div data-testid="trash-section">Trash: {trashedSecrets.length}</div>
  ),
  SyncButton: () => <button data-testid="sync-button">Sync</button>,
}))

describe('VaultDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVaultLoading = false
    mockSecretsLoading = false
    mockTrashLoading = false
    mockVaultError = null
    mockSecretsError = null
  })

  describe('Loading State', () => {
    it('should show loading skeletons when data is loading', () => {
      mockVaultLoading = true
      mockSecretsLoading = true
      render(<VaultDetailPage />)

      expect(screen.getAllByTestId('secret-row-skeleton')).toHaveLength(5)
    })
  })

  describe('Vault Header', () => {
    it('should render vault name and stats', () => {
      render(<VaultDetailPage />)

      expect(screen.getByText('testowner/testrepo')).toBeInTheDocument()
      expect(screen.getByText('3 secrets · 3 environments')).toBeInTheDocument()
    })

    it('should render vault avatar', () => {
      render(<VaultDetailPage />)

      const avatar = screen.getByAltText('testowner')
      expect(avatar).toHaveAttribute('src', 'https://avatar.example.com/testowner.png')
    })

    it('should show Add Secrets dropdown for admin users', () => {
      render(<VaultDetailPage />)

      expect(screen.getByText('Add Secrets')).toBeInTheDocument()
    })

    it('should show permission badge', () => {
      render(<VaultDetailPage />)

      expect(screen.getByText('Admin')).toBeInTheDocument()
      expect(screen.getByText('on GitHub')).toBeInTheDocument()
    })

    it('should show Collaborators button for admin', () => {
      render(<VaultDetailPage />)

      expect(screen.getByText('Collaborators')).toBeInTheDocument()
    })
  })

  describe('Environment Filters', () => {
    it('should render all environments as filter buttons', () => {
      render(<VaultDetailPage />)

      // Check environment names exist in the document
      expect(screen.getAllByText('default').length).toBeGreaterThan(0)
      expect(screen.getAllByText('staging').length).toBeGreaterThan(0)
      expect(screen.getAllByText('production').length).toBeGreaterThan(0)
      expect(screen.getByText('All')).toBeInTheDocument()
    })

    it('should show All filter by default', () => {
      render(<VaultDetailPage />)

      expect(screen.getByText('All')).toBeInTheDocument()
    })

    it('should filter secrets when environment is clicked', async () => {
      render(<VaultDetailPage />)

      // Wait for initial render with all secrets
      await waitFor(() => {
        expect(screen.getByText('3 of 3')).toBeInTheDocument()
      })

      // Find the production environment button by its text
      const productionButtons = screen.getAllByRole('button').filter(
        btn => btn.textContent === 'production'
      )

      if (productionButtons.length > 0) {
        fireEvent.click(productionButtons[0])
      }

      // Should show filtered count (2 secrets are in production environment)
      await waitFor(() => {
        expect(screen.getByText('2 of 3')).toBeInTheDocument()
      }, { timeout: 3000 })
    })
  })

  describe('Secrets List', () => {
    it('should render all secrets', () => {
      render(<VaultDetailPage />)

      expect(screen.getByTestId('secret-row-secret-1')).toBeInTheDocument()
      expect(screen.getByTestId('secret-row-secret-2')).toBeInTheDocument()
      expect(screen.getByTestId('secret-row-secret-3')).toBeInTheDocument()
    })

    it('should show View button on secrets', () => {
      render(<VaultDetailPage />)

      const viewButtons = screen.getAllByText('View')
      expect(viewButtons.length).toBeGreaterThan(0)
    })

    it('should show Edit button on secrets for admin', () => {
      render(<VaultDetailPage />)

      const editButtons = screen.getAllByText('Edit')
      expect(editButtons.length).toBeGreaterThan(0)
    })

    it('should show Delete button on secrets for admin', () => {
      render(<VaultDetailPage />)

      const deleteButtons = screen.getAllByText('Delete')
      expect(deleteButtons.length).toBeGreaterThan(0)
    })
  })

  describe('Search', () => {
    it('should render search input', () => {
      render(<VaultDetailPage />)

      expect(screen.getByPlaceholderText('Search secrets...')).toBeInTheDocument()
    })

    it('should filter secrets when searching', async () => {
      const user = userEvent.setup()
      render(<VaultDetailPage />)

      // Wait for initial render
      await waitFor(() => {
        expect(screen.getByText('3 of 3')).toBeInTheDocument()
      })

      const searchInput = screen.getByPlaceholderText('Search secrets...')
      await user.type(searchInput, 'DATABASE')

      await waitFor(() => {
        expect(screen.getByText('1 of 3')).toBeInTheDocument()
      }, { timeout: 3000 })
    })
  })

  describe('Error State', () => {
    it('should show error state when vault fails to load', () => {
      mockVaultError = new Error('Failed to load vault')
      render(<VaultDetailPage />)

      expect(screen.getByTestId('error-state')).toBeInTheDocument()
      expect(screen.getByText('Failed to load vault')).toBeInTheDocument()
    })

    it('should show error state when secrets fail to load', () => {
      mockSecretsError = new Error('Failed to load secrets')
      render(<VaultDetailPage />)

      expect(screen.getByTestId('error-state')).toBeInTheDocument()
    })
  })

  describe('Modals', () => {
    it('should open secret modal when Add Secrets is clicked', async () => {
      const user = userEvent.setup()
      render(<VaultDetailPage />)

      // Click dropdown trigger
      const addButton = screen.getByText('Add Secrets')
      await user.click(addButton)

      // Click Add single secret
      const addSingleOption = await screen.findByText('Add single secret')
      await user.click(addSingleOption)

      expect(screen.getByTestId('secret-modal')).toBeInTheDocument()
    })

    it('should open bulk import modal when Import is clicked', async () => {
      const user = userEvent.setup()
      render(<VaultDetailPage />)

      // Click dropdown trigger
      const addButton = screen.getByText('Add Secrets')
      await user.click(addButton)

      // Click Import from .env
      const importOption = await screen.findByText('Import from .env')
      await user.click(importOption)

      expect(screen.getByTestId('bulk-import-modal')).toBeInTheDocument()
    })

    it('should open view secret modal when View is clicked', async () => {
      const user = userEvent.setup()
      render(<VaultDetailPage />)

      const viewButtons = screen.getAllByText('View')
      await user.click(viewButtons[0])

      expect(screen.getByTestId('view-secret-modal')).toBeInTheDocument()
    })
  })

  describe('Back Navigation', () => {
    it('should render back link to vaults', () => {
      render(<VaultDetailPage />)

      const backLink = screen.getByText('Back to vaults')
      expect(backLink.closest('a')).toHaveAttribute('href', '/')
    })
  })

  describe('Trash Section', () => {
    it('should render trash section', () => {
      render(<VaultDetailPage />)

      expect(screen.getByTestId('trash-section')).toBeInTheDocument()
    })
  })

  describe('Incomplete Secrets Warning', () => {
    it('should show warning when secrets are missing in some environments', () => {
      render(<VaultDetailPage />)

      // DATABASE_URL is only in production, not in staging or default
      expect(screen.getByText(/missing in some environments/)).toBeInTheDocument()
    })
  })
})
