import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ApiKeysPage from '../../app/(dashboard)/api-keys/page'
import type { ApiKey, CreateApiKeyResponse } from '../../lib/types'

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock analytics
vi.mock('../../lib/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    API_KEYS_VIEW: 'api_keys_view',
    API_KEY_CREATE: 'api_key_create',
    API_KEY_REVOKE: 'api_key_revoke',
    API_KEY_COPY: 'api_key_copy',
  },
}))

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
})

const mockActiveApiKey: ApiKey = {
  id: 'key-1',
  name: 'Production CI/CD',
  prefix: 'kw_live_',
  environment: 'live',
  scopes: ['read:secrets', 'write:secrets'],
  isActive: true,
  usageCount: 150,
  lastUsedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
  createdAt: '2025-01-01T00:00:00Z',
  revokedAt: null,
}

const mockInactiveApiKey: ApiKey = {
  id: 'key-2',
  name: 'Old Key',
  prefix: 'kw_live_',
  environment: 'live',
  scopes: ['read:secrets'],
  isActive: false,
  usageCount: 50,
  lastUsedAt: '2024-12-01T00:00:00Z',
  expiresAt: null,
  createdAt: '2024-06-01T00:00:00Z',
  revokedAt: '2024-12-15T00:00:00Z',
}

const mockExpiredApiKey: ApiKey = {
  id: 'key-3',
  name: 'Expired Key',
  prefix: 'kw_live_',
  environment: 'live',
  scopes: ['read:secrets'],
  isActive: true,
  usageCount: 10,
  lastUsedAt: null,
  expiresAt: '2024-01-01T00:00:00Z', // Expired
  createdAt: '2023-01-01T00:00:00Z',
  revokedAt: null,
}

let mockApiKeys: ApiKey[] = []
let mockApiKeysLoading = false
let mockApiKeysError: Error | null = null

const mockQueryClient = {
  invalidateQueries: vi.fn(),
  setQueryData: vi.fn(),
}

const mockMutate = vi.fn()

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'apiKeys') {
      return {
        data: mockApiKeysLoading ? undefined : mockApiKeys,
        isLoading: mockApiKeysLoading,
        error: mockApiKeysError,
        refetch: vi.fn(),
      }
    }
    return { data: undefined, isLoading: false, error: null }
  },
  useMutation: ({ onSuccess }: { onSuccess?: (data: unknown, id: string) => void }) => ({
    mutate: mockMutate.mockImplementation((id: string) => {
      if (onSuccess) onSuccess(undefined, id)
    }),
    isPending: false,
  }),
  useQueryClient: () => mockQueryClient,
}))

// Mock API
vi.mock('../../lib/api', () => ({
  api: {
    getApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
  },
}))

// Mock dashboard components
vi.mock('../../app/components/dashboard', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div data-testid="dashboard-layout">{children}</div>,
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
}))

describe('ApiKeysPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiKeys = [mockActiveApiKey]
    mockApiKeysLoading = false
    mockApiKeysError = null
  })

  describe('Page Header', () => {
    it('should render page title and description', () => {
      render(<ApiKeysPage />)

      expect(screen.getByText('API Keys')).toBeInTheDocument()
      expect(screen.getByText('Manage programmatic access to Keyway')).toBeInTheDocument()
    })

    it('should render Create Key button', () => {
      render(<ApiKeysPage />)

      expect(screen.getByText('Create Key')).toBeInTheDocument()
    })

    it('should render info banner about secure API access', () => {
      render(<ApiKeysPage />)

      expect(screen.getByText('Secure API Access')).toBeInTheDocument()
      expect(screen.getByText(/API keys allow programmatic access/)).toBeInTheDocument()
    })
  })

  describe('Loading State', () => {
    it('should show skeletons when loading', () => {
      mockApiKeysLoading = true
      mockApiKeys = []
      render(<ApiKeysPage />)

      // Should render skeleton cards
      expect(screen.getByTestId('dashboard-layout')).toBeInTheDocument()
    })
  })

  describe('Error State', () => {
    it('should show error state when API fails', () => {
      mockApiKeysError = new Error('Failed to load API keys')
      render(<ApiKeysPage />)

      expect(screen.getByTestId('error-state')).toBeInTheDocument()
      expect(screen.getByText('Failed to load API keys')).toBeInTheDocument()
    })
  })

  describe('Empty State', () => {
    it('should show empty state when no API keys', () => {
      mockApiKeys = []
      render(<ApiKeysPage />)

      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
      expect(screen.getByText('No API keys yet')).toBeInTheDocument()
      expect(screen.getByText('Create your first API key')).toBeInTheDocument()
    })
  })

  describe('API Key Cards', () => {
    it('should render active API keys', () => {
      render(<ApiKeysPage />)

      expect(screen.getByText('Production CI/CD')).toBeInTheDocument()
      expect(screen.getByText('Active Keys (1)')).toBeInTheDocument()
    })

    it('should show key prefix masked', () => {
      render(<ApiKeysPage />)

      expect(screen.getByText('kw_live_••••••••')).toBeInTheDocument()
    })

    it('should show scopes as badges', () => {
      render(<ApiKeysPage />)

      expect(screen.getByText('read:secrets')).toBeInTheDocument()
      expect(screen.getByText('write:secrets')).toBeInTheDocument()
    })

    it('should show usage count', () => {
      render(<ApiKeysPage />)

      expect(screen.getByText(/150 requests/)).toBeInTheDocument()
    })

    it('should render inactive keys section when present', () => {
      mockApiKeys = [mockActiveApiKey, mockInactiveApiKey]
      render(<ApiKeysPage />)

      expect(screen.getByText('Active Keys (1)')).toBeInTheDocument()
      expect(screen.getByText('Inactive Keys (1)')).toBeInTheDocument()
    })

    it('should show Revoked badge for revoked keys', () => {
      mockApiKeys = [mockInactiveApiKey]
      render(<ApiKeysPage />)

      expect(screen.getByText('Revoked')).toBeInTheDocument()
    })

    it('should show Expired badge for expired keys', () => {
      mockApiKeys = [mockExpiredApiKey]
      render(<ApiKeysPage />)

      expect(screen.getByText('Expired')).toBeInTheDocument()
    })
  })

  describe('Create API Key Modal', () => {
    it('should have Create Key button that triggers modal', async () => {
      render(<ApiKeysPage />)

      const createButton = screen.getByRole('button', { name: /Create Key/i })
      expect(createButton).toBeInTheDocument()

      // Click and verify the dialog opens (checking for dialog content)
      fireEvent.click(createButton)

      // Wait for modal to appear
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })
    })

    it('should render name input in create modal', async () => {
      const user = userEvent.setup()
      render(<ApiKeysPage />)

      await user.click(screen.getByText('Create Key'))

      expect(screen.getByLabelText('Name')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('e.g., CI/CD Production')).toBeInTheDocument()
    })

    it('should render scope checkboxes', async () => {
      const user = userEvent.setup()
      render(<ApiKeysPage />)

      await user.click(screen.getByText('Create Key'))

      expect(screen.getByText('Read Secrets')).toBeInTheDocument()
      expect(screen.getByText('Write Secrets')).toBeInTheDocument()
      expect(screen.getByText('Delete Secrets')).toBeInTheDocument()
      expect(screen.getByText('Manage API Keys')).toBeInTheDocument()
    })

    it('should render expiration selector', async () => {
      const user = userEvent.setup()
      render(<ApiKeysPage />)

      await user.click(screen.getByText('Create Key'))

      expect(screen.getByText('Expiration')).toBeInTheDocument()
    })

    it('should have Cancel button in modal', async () => {
      render(<ApiKeysPage />)

      // Open modal
      fireEvent.click(screen.getByRole('button', { name: /Create Key/i }))

      // Wait for modal and find Cancel button
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument()
      })
    })
  })

  describe('Revoke API Key', () => {
    it('should show revoke confirmation when delete button is clicked', async () => {
      const user = userEvent.setup()
      render(<ApiKeysPage />)

      // Find the delete button (trash icon)
      const deleteButtons = screen.getAllByRole('button')
      const trashButton = deleteButtons.find(btn =>
        btn.querySelector('svg.lucide-trash-2') || btn.className.includes('destructive')
      )

      if (trashButton) {
        await user.click(trashButton)
      }

      await waitFor(() => {
        expect(screen.getByText('Revoke API Key')).toBeInTheDocument()
      })
    })
  })
})

describe('Helper Functions', () => {
  // Test the date formatting functions by checking the rendered output
  it('should format last used date correctly for recent usage', () => {
    const recentKey: ApiKey = {
      ...mockActiveApiKey,
      lastUsedAt: new Date().toISOString(),
    }
    mockApiKeys = [recentKey]
    render(<ApiKeysPage />)

    // Should show something like "Just now" or "X minutes ago"
    expect(screen.getByText(/Just now|minutes ago|hours ago/)).toBeInTheDocument()
  })

  it('should show Never used for keys with null lastUsedAt', () => {
    const neverUsedKey: ApiKey = {
      ...mockActiveApiKey,
      lastUsedAt: null,
      usageCount: 0,
    }
    mockApiKeys = [neverUsedKey]
    render(<ApiKeysPage />)

    expect(screen.getByText('Never used')).toBeInTheDocument()
  })
})
