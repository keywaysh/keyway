import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SecurityAccessLogTab } from '../../app/(dashboard)/security/_components/SecurityAccessLogTab'
import type { AccessLogEvent, AccessLogResponse, Vault } from '../../lib/types'

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// Mock analytics
vi.mock('../../lib/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    SECURITY_ACCESS_LOG_VIEW: 'security_access_log_view',
    SECURITY_ACCESS_LOG_FILTER: 'security_access_log_filter',
  },
}))

// Mock dashboard components
vi.mock('../../app/components/dashboard', () => ({
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

// Mock date-utils
vi.mock('../../lib/date-utils', () => ({
  formatRelativeTime: (date: string) => 'Just now',
}))

const mockEvents: AccessLogEvent[] = [
  {
    id: 'event-1',
    action: 'pull',
    timestamp: new Date().toISOString(),
    ip: '192.168.1.1',
    user: {
      id: 'user-1',
      username: 'testuser',
      avatarUrl: 'https://avatar.example.com/testuser.png',
    },
    vault: {
      id: 'vault-1',
      repoFullName: 'owner/repo1',
    },
    location: {
      city: 'New York',
      country: 'US',
    },
    metadata: {
      platform: 'cli',
      environment: 'production',
    },
    hasAlert: false,
  },
  {
    id: 'event-2',
    action: 'view',
    timestamp: new Date().toISOString(),
    ip: '10.0.0.1',
    user: {
      id: 'user-2',
      username: 'anotheruser',
      avatarUrl: null,
    },
    vault: {
      id: 'vault-2',
      repoFullName: 'owner/repo2',
    },
    location: null,
    metadata: {
      platform: 'dashboard',
      secretKey: 'API_KEY',
    },
    hasAlert: true,
  },
]

const mockVaults: Vault[] = [
  {
    id: 'vault-1',
    repo_id: 'repo-1',
    repo_name: 'repo1',
    repo_owner: 'owner',
    repo_full_name: 'owner/repo1',
    repo_avatar: null,
    provider: 'github',
    is_private: false,
    permission: 'admin',
    secrets_count: 5,
    environments: ['default'],
    collaborators_count: 2,
    is_read_only: false,
    readonly_reason: null,
    syncs: [],
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
]

let mockAccessLogResponse: AccessLogResponse = {
  events: mockEvents,
  total: 2,
}
let mockApiError: Error | null = null

vi.mock('../../lib/api', () => ({
  api: {
    getAccessLog: vi.fn(() => {
      if (mockApiError) throw mockApiError
      return Promise.resolve(mockAccessLogResponse)
    }),
    getVaults: vi.fn(() => Promise.resolve(mockVaults)),
  },
}))

describe('SecurityAccessLogTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAccessLogResponse = {
      events: mockEvents,
      total: 2,
    }
    mockApiError = null
  })

  describe('Header', () => {
    it('should render header with title', async () => {
      render(<SecurityAccessLogTab />)

      await waitFor(() => {
        expect(screen.getByText('Access Log')).toBeInTheDocument()
        expect(screen.getByText('Track who accessed secrets via CLI or dashboard')).toBeInTheDocument()
      })
    })

    it('should render vault filter dropdown', async () => {
      render(<SecurityAccessLogTab />)

      await waitFor(() => {
        expect(screen.getByText('All vaults')).toBeInTheDocument()
      })
    })
  })

  describe('Error State', () => {
    it('should show error state when API fails', async () => {
      mockApiError = new Error('Network error')
      render(<SecurityAccessLogTab />)

      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument()
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
    })

    it('should have retry button', async () => {
      mockApiError = new Error('Network error')
      render(<SecurityAccessLogTab />)

      await waitFor(() => {
        expect(screen.getByText('Retry')).toBeInTheDocument()
      })
    })
  })

  describe('Empty State', () => {
    it('should show empty state when no events', async () => {
      mockAccessLogResponse = { events: [], total: 0 }
      render(<SecurityAccessLogTab />)

      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument()
        expect(screen.getByText('No access events')).toBeInTheDocument()
      })
    })
  })

  describe('Access Log List', () => {
    it('should render access events', async () => {
      render(<SecurityAccessLogTab />)

      await waitFor(() => {
        expect(screen.getByText('testuser')).toBeInTheDocument()
        expect(screen.getByText('anotheruser')).toBeInTheDocument()
      })
    })

    it('should show action labels', async () => {
      render(<SecurityAccessLogTab />)

      await waitFor(() => {
        expect(screen.getByText('pulled secrets from')).toBeInTheDocument()
        expect(screen.getByText('viewed secret in')).toBeInTheDocument()
      })
    })

    it('should link to vault pages', async () => {
      render(<SecurityAccessLogTab />)

      await waitFor(() => {
        const link = screen.getByText('owner/repo1')
        expect(link.closest('a')).toHaveAttribute('href', '/vaults/owner/repo1')
      })
    })

    it('should show IP addresses', async () => {
      render(<SecurityAccessLogTab />)

      await waitFor(() => {
        expect(screen.getByText('192.168.1.1')).toBeInTheDocument()
        expect(screen.getByText('10.0.0.1')).toBeInTheDocument()
      })
    })

    it('should show locations', async () => {
      render(<SecurityAccessLogTab />)

      await waitFor(() => {
        expect(screen.getByText('New York, US')).toBeInTheDocument()
      })
    })

    it('should show platform badges', async () => {
      render(<SecurityAccessLogTab />)

      await waitFor(() => {
        expect(screen.getByText('CLI')).toBeInTheDocument()
        expect(screen.getByText('Dashboard')).toBeInTheDocument()
      })
    })

    it('should show environment when present', async () => {
      render(<SecurityAccessLogTab />)

      await waitFor(() => {
        expect(screen.getByText('production')).toBeInTheDocument()
      })
    })

    it('should show secret key when present', async () => {
      render(<SecurityAccessLogTab />)

      await waitFor(() => {
        expect(screen.getByText('API_KEY')).toBeInTheDocument()
      })
    })

    it('should show Alert badge when event has alert', async () => {
      render(<SecurityAccessLogTab />)

      await waitFor(() => {
        expect(screen.getByText('Alert')).toBeInTheDocument()
      })
    })

    it('should show event count', async () => {
      render(<SecurityAccessLogTab />)

      await waitFor(() => {
        expect(screen.getByText('Showing 2 of 2 events')).toBeInTheDocument()
      })
    })
  })

  describe('Pagination', () => {
    it('should show Load more button when there are more events', async () => {
      mockAccessLogResponse = {
        events: mockEvents.slice(0, 1),
        total: 5,
      }
      render(<SecurityAccessLogTab />)

      await waitFor(() => {
        expect(screen.getByText('Load more')).toBeInTheDocument()
      })
    })

    it('should not show Load more when all events are loaded', async () => {
      render(<SecurityAccessLogTab />)

      await waitFor(() => {
        expect(screen.queryByText('Load more')).not.toBeInTheDocument()
      })
    })
  })

  describe('Timestamps', () => {
    it('should format timestamps', async () => {
      render(<SecurityAccessLogTab />)

      await waitFor(() => {
        expect(screen.getAllByText('Just now').length).toBeGreaterThan(0)
      })
    })
  })
})
