import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import ActivityPage from '../../app/(dashboard)/activity/page'
import type { ActivityEvent } from '../../lib/types'

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

// Mock analytics
vi.mock('../../lib/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    ACTIVITY_VIEW: 'activity_view',
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
  EmptyState: ({ title, message }: { title: string; message: string }) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  ),
}))

const mockEvents: ActivityEvent[] = [
  {
    id: 'event-1',
    action: 'secret_created',
    category: 'secrets',
    vault_id: 'vault-1',
    vault_name: 'owner/repo',
    user_name: 'testuser',
    user_avatar: 'https://avatar.example.com/testuser.png',
    platform: 'web',
    timestamp: new Date().toISOString(),
    secret_name: 'API_KEY',
    environment: 'production',
  },
  {
    id: 'event-2',
    action: 'secrets_pulled',
    category: 'access',
    vault_id: 'vault-1',
    vault_name: 'owner/repo',
    user_name: 'testuser',
    user_avatar: 'https://avatar.example.com/testuser.png',
    platform: 'cli',
    timestamp: new Date().toISOString(),
    count: 5,
  },
  {
    id: 'event-3',
    action: 'vault_created',
    category: 'vaults',
    vault_id: 'vault-2',
    vault_name: 'owner/newrepo',
    user_name: 'anotheruser',
    user_avatar: 'https://avatar.example.com/anotheruser.png',
    platform: 'web',
    timestamp: new Date(Date.now() - 86400000).toISOString(), // Yesterday
  },
]

let mockApiResponse: ActivityEvent[] = mockEvents
let mockApiError: Error | null = null

vi.mock('../../lib/api', () => ({
  api: {
    getActivity: vi.fn(() => {
      if (mockApiError) throw mockApiError
      return Promise.resolve(mockApiResponse)
    }),
  },
}))

describe('ActivityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiResponse = mockEvents
    mockApiError = null
  })

  describe('Page Header', () => {
    it('should render page title and description', async () => {
      render(<ActivityPage />)

      await waitFor(() => {
        expect(screen.getByText('Activity')).toBeInTheDocument()
        expect(screen.getByText('Recent actions across all your vaults')).toBeInTheDocument()
      })
    })
  })

  describe('Category Filters', () => {
    it('should render all category filter buttons', async () => {
      render(<ActivityPage />)

      await waitFor(() => {
        expect(screen.getByText('All')).toBeInTheDocument()
        expect(screen.getByText('Secrets')).toBeInTheDocument()
        expect(screen.getByText('Access')).toBeInTheDocument()
        expect(screen.getByText('Environments')).toBeInTheDocument()
        expect(screen.getByText('Vaults')).toBeInTheDocument()
        expect(screen.getByText('Integrations')).toBeInTheDocument()
        expect(screen.getByText('Billing')).toBeInTheDocument()
        expect(screen.getByText('Account')).toBeInTheDocument()
      })
    })

    it('should filter by category when clicked', async () => {
      render(<ActivityPage />)

      await waitFor(() => {
        // Click Secrets filter
        const secretsButton = screen.getByText('Secrets')
        fireEvent.click(secretsButton)
      })

      // Should filter to show only secrets
      await waitFor(() => {
        expect(screen.getByText('API_KEY')).toBeInTheDocument()
      })
    })

    it('should show counts for categories with events', async () => {
      render(<ActivityPage />)

      await waitFor(() => {
        // Secrets should show count 1
        const secretsButton = screen.getByText('Secrets')
        expect(secretsButton.parentElement?.textContent).toContain('1')
      })
    })
  })

  describe('Error State', () => {
    it('should show error state when API fails', async () => {
      mockApiError = new Error('Network error')
      render(<ActivityPage />)

      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument()
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
    })

    it('should have retry button', async () => {
      mockApiError = new Error('Network error')
      render(<ActivityPage />)

      await waitFor(() => {
        expect(screen.getByText('Retry')).toBeInTheDocument()
      })
    })
  })

  describe('Empty State', () => {
    it('should show empty state when no events', async () => {
      mockApiResponse = []
      render(<ActivityPage />)

      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument()
        expect(screen.getByText('No activity yet')).toBeInTheDocument()
      })
    })

    it('should show category-specific empty message', async () => {
      mockApiResponse = []
      render(<ActivityPage />)

      await waitFor(() => {
        // Click on Secrets filter
        const secretsButton = screen.getByText('Secrets')
        fireEvent.click(secretsButton)
      })

      await waitFor(() => {
        expect(screen.getByText('No secrets activity')).toBeInTheDocument()
      })
    })
  })

  describe('Activity Events', () => {
    it('should render activity events', async () => {
      render(<ActivityPage />)

      await waitFor(() => {
        // testuser appears in multiple events
        expect(screen.getAllByText('testuser').length).toBeGreaterThan(0)
      })
    })

    it('should show vault names', async () => {
      render(<ActivityPage />)

      await waitFor(() => {
        // owner/repo appears in multiple events
        expect(screen.getAllByText('owner/repo').length).toBeGreaterThan(0)
      })
    })

    it('should show secret names', async () => {
      render(<ActivityPage />)

      await waitFor(() => {
        expect(screen.getByText('API_KEY')).toBeInTheDocument()
      })
    })

    it('should group events by date', async () => {
      render(<ActivityPage />)

      await waitFor(() => {
        expect(screen.getByText('Today')).toBeInTheDocument()
        expect(screen.getByText('Yesterday')).toBeInTheDocument()
      })
    })

    it('should link vault names to vault pages', async () => {
      render(<ActivityPage />)

      await waitFor(() => {
        const links = screen.getAllByText('owner/repo')
        expect(links[0].closest('a')).toHaveAttribute('href', '/vaults/owner/repo')
      })
    })
  })

  describe('Action Labels', () => {
    it('should display human-readable action for secret_created', async () => {
      render(<ActivityPage />)

      await waitFor(() => {
        // "created" appears in action descriptions
        const createdElements = screen.getAllByText(/created/)
        expect(createdElements.length).toBeGreaterThan(0)
      })
    })

    it('should display human-readable action for vault_created', async () => {
      render(<ActivityPage />)

      await waitFor(() => {
        expect(screen.getByText(/created vault/)).toBeInTheDocument()
      })
    })
  })
})
