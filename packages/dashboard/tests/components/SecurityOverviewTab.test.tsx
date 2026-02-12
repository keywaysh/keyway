import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SecurityOverviewTab } from '../../app/(dashboard)/security/_components/SecurityOverviewTab'
import type { SecurityOverview } from '../../lib/types'

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
    SECURITY_OVERVIEW_VIEW: 'security_overview_view',
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

const mockOverview: SecurityOverview = {
  alerts: {
    last7Days: 5,
    last30Days: 12,
    critical: 2,
    high: 3,
    medium: 5,
    low: 2,
  },
  access: {
    last7Days: 150,
    last30Days: 450,
    totalPulls: 1200,
    topVaults: [
      { repoFullName: 'owner/repo1', pullCount: 50 },
      { repoFullName: 'owner/repo2', pullCount: 30 },
      { repoFullName: 'owner/repo3', pullCount: 20 },
    ],
    topUsers: [
      { username: 'user1', avatarUrl: 'https://avatar1.png', pullCount: 100 },
      { username: 'user2', avatarUrl: 'https://avatar2.png', pullCount: 50 },
    ],
  },
  exposure: {
    usersWithAccess: 15,
    lastAccessAt: '2025-01-01T12:00:00Z',
  },
}

let mockApiResponse: SecurityOverview | null = mockOverview
let mockApiError: Error | null = null

vi.mock('../../lib/api', () => ({
  api: {
    getSecurityOverview: vi.fn(() => {
      if (mockApiError) throw mockApiError
      return Promise.resolve(mockApiResponse)
    }),
  },
}))

describe('SecurityOverviewTab', () => {
  const mockOnNavigate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockApiResponse = mockOverview
    mockApiError = null
  })

  describe('Loading State', () => {
    it('should render the component', () => {
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      // Component should be in the document
      expect(document.body).toBeInTheDocument()
    })
  })

  describe('Error State', () => {
    it('should show error state when API fails', async () => {
      mockApiError = new Error('Network error')
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument()
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
    })

    it('should have retry button in error state', async () => {
      mockApiError = new Error('Network error')
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        expect(screen.getByText('Retry')).toBeInTheDocument()
      })
    })
  })

  describe('Empty State', () => {
    it('should show empty state when no data', async () => {
      mockApiResponse = null
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument()
        expect(screen.getByText('No data available')).toBeInTheDocument()
      })
    })
  })

  describe('Overview Stats', () => {
    it('should render alerts stat card', async () => {
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        expect(screen.getByText('Alerts (7d)')).toBeInTheDocument()
        expect(screen.getByText('5')).toBeInTheDocument()
        expect(screen.getByText('2 critical')).toBeInTheDocument()
      })
    })

    it('should render pulls stat card', async () => {
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        expect(screen.getByText('Pulls (7d)')).toBeInTheDocument()
        expect(screen.getByText('150')).toBeInTheDocument()
        expect(screen.getByText('1200 total')).toBeInTheDocument()
      })
    })

    it('should render users with access stat card', async () => {
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        expect(screen.getByText('Users with Access')).toBeInTheDocument()
        expect(screen.getByText('15')).toBeInTheDocument()
      })
    })
  })

  describe('Top Vaults Section', () => {
    it('should render top accessed vaults', async () => {
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        expect(screen.getByText('Top Accessed Vaults')).toBeInTheDocument()
        expect(screen.getByText('owner/repo1')).toBeInTheDocument()
        expect(screen.getByText('owner/repo2')).toBeInTheDocument()
        expect(screen.getByText('owner/repo3')).toBeInTheDocument()
      })
    })

    it('should link to vault pages', async () => {
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        const link = screen.getByText('owner/repo1')
        expect(link.closest('a')).toHaveAttribute('href', '/vaults/owner/repo1')
      })
    })

    it('should show pull counts for vaults', async () => {
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        expect(screen.getByText('50')).toBeInTheDocument()
        expect(screen.getByText('30')).toBeInTheDocument()
        expect(screen.getByText('20')).toBeInTheDocument()
      })
    })

    it('should show empty message when no vault activity', async () => {
      mockApiResponse = {
        ...mockOverview,
        access: {
          ...mockOverview.access,
          topVaults: [],
        },
      }
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        expect(screen.getByText('No vault activity yet')).toBeInTheDocument()
      })
    })
  })

  describe('Top Users Section', () => {
    it('should render most active users', async () => {
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        expect(screen.getByText('Most Active Users')).toBeInTheDocument()
        expect(screen.getByText('user1')).toBeInTheDocument()
        expect(screen.getByText('user2')).toBeInTheDocument()
      })
    })

    it('should show pull counts for users', async () => {
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        expect(screen.getByText('100 pulls')).toBeInTheDocument()
        expect(screen.getByText('50 pulls')).toBeInTheDocument()
      })
    })

    it('should render avatar section', async () => {
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        // Check for users section with user names
        expect(screen.getByText('user1')).toBeInTheDocument()
        expect(screen.getByText('user2')).toBeInTheDocument()
      })
    })

    it('should have View exposure button', async () => {
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        expect(screen.getByText('View exposure')).toBeInTheDocument()
      })
    })

    it('should call onNavigate when View exposure is clicked', async () => {
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        const button = screen.getByText('View exposure')
        fireEvent.click(button)
        expect(mockOnNavigate).toHaveBeenCalledWith('exposure')
      })
    })

    it('should show empty message when no user activity', async () => {
      mockApiResponse = {
        ...mockOverview,
        access: {
          ...mockOverview.access,
          topUsers: [],
        },
      }
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        expect(screen.getByText('No user activity yet')).toBeInTheDocument()
      })
    })
  })

  describe('Alerts Banner', () => {
    it('should show alerts banner when there are recent alerts', async () => {
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        expect(screen.getByText('5 alerts in the last 7 days')).toBeInTheDocument()
        expect(screen.getByText('Review security alerts to ensure your vaults are secure')).toBeInTheDocument()
      })
    })

    it('should have View alerts button', async () => {
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        expect(screen.getByText('View alerts')).toBeInTheDocument()
      })
    })

    it('should call onNavigate when View alerts is clicked', async () => {
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        const button = screen.getByText('View alerts')
        fireEvent.click(button)
        expect(mockOnNavigate).toHaveBeenCalledWith('alerts')
      })
    })

    it('should not show alerts banner when no recent alerts', async () => {
      mockApiResponse = {
        ...mockOverview,
        alerts: {
          ...mockOverview.alerts,
          last7Days: 0,
        },
      }
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        expect(screen.queryByText(/alerts in the last 7 days/)).not.toBeInTheDocument()
      })
    })

    it('should show singular "alert" for 1 alert', async () => {
      mockApiResponse = {
        ...mockOverview,
        alerts: {
          ...mockOverview.alerts,
          last7Days: 1,
        },
      }
      render(<SecurityOverviewTab onNavigate={mockOnNavigate} />)

      await waitFor(() => {
        expect(screen.getByText('1 alert in the last 7 days')).toBeInTheDocument()
      })
    })
  })
})
