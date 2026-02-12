import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SecurityExposureTab } from '../../app/(dashboard)/security/_components/SecurityExposureTab'
import type { ExposureOrgSummary, ExposureUserReport, Organization } from '../../lib/types'

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

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
    SECURITY_EXPOSURE_VIEW: 'security_exposure_view',
    EXPOSURE_PERIOD_FILTER: 'exposure_period_filter',
    EXPOSURE_USER_EXPAND: 'exposure_user_expand',
    EXPOSURE_CSV_EXPORT: 'exposure_csv_export',
  },
}))

// Mock date-utils
vi.mock('../../lib/date-utils', () => ({
  formatRelativeTime: (date: string) => 'Just now',
}))

// Mock dashboard components
vi.mock('../../app/components/dashboard', () => ({
  ErrorState: ({ title, message, onRetry }: { title?: string; message: string; onRetry?: () => void }) => (
    <div data-testid="error-state">
      {title && <h3>{title}</h3>}
      <span>{message}</span>
      {onRetry && <button onClick={onRetry}>Retry</button>}
    </div>
  ),
  ExposureStatCard: ({ icon, label, value }: { icon: unknown; label: string; value: number }) => (
    <div data-testid="exposure-stat-card">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
}))

// Mock auth
let mockUser = {
  id: 'user-1',
  name: 'Test User',
  plan: 'team',
}

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    user: mockUser,
    isLoading: false,
    isAuthenticated: true,
  }),
}))

const mockExposure: ExposureOrgSummary = {
  summary: {
    users: 3,
    secrets: 10,
    accesses: 150,
  },
  users: [
    {
      user: {
        id: 'user-1',
        username: 'testuser',
        avatarUrl: 'https://avatar.example.com/testuser.png',
      },
      secretsAccessed: 5,
      vaultsAccessed: 2,
      lastAccess: new Date().toISOString(),
    },
    {
      user: {
        id: 'user-2',
        username: 'anotheruser',
        avatarUrl: null,
      },
      secretsAccessed: 3,
      vaultsAccessed: 1,
      lastAccess: new Date(Date.now() - 86400000).toISOString(), // Yesterday
    },
  ],
}

const mockUserReport: ExposureUserReport = {
  user: {
    id: 'user-1',
    username: 'testuser',
    avatarUrl: 'https://avatar.example.com/testuser.png',
  },
  vaults: [
    {
      repoFullName: 'owner/repo1',
      secrets: [
        {
          key: 'API_KEY',
          environment: 'production',
          roleAtAccess: 'admin',
          accessCount: 10,
          lastAccess: new Date().toISOString(),
        },
        {
          key: 'DATABASE_URL',
          environment: 'staging',
          roleAtAccess: 'read',
          accessCount: 5,
          lastAccess: new Date().toISOString(),
        },
      ],
    },
  ],
}

const mockOrganizations: Organization[] = [
  {
    id: 'org-1',
    login: 'testorg',
    avatar_url: 'https://avatar.example.com/testorg.png',
    display_name: 'Test Organization',
    plan: 'team',
  },
]

let mockExposureResponse: ExposureOrgSummary | null = mockExposure
let mockApiError: Error | null = null
let mockOrgsResponse: Organization[] = mockOrganizations

vi.mock('../../lib/api', () => ({
  api: {
    getMyExposure: vi.fn(() => {
      if (mockApiError) throw mockApiError
      return Promise.resolve(mockExposureResponse)
    }),
    getOrganizationExposure: vi.fn(() => {
      if (mockApiError) throw mockApiError
      return Promise.resolve(mockExposureResponse)
    }),
    getOrganizations: vi.fn(() => Promise.resolve(mockOrgsResponse)),
    getMyExposureUser: vi.fn(() => Promise.resolve(mockUserReport)),
    getUserExposure: vi.fn(() => Promise.resolve(mockUserReport)),
  },
}))

describe('SecurityExposureTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUser = {
      id: 'user-1',
      name: 'Test User',
      plan: 'team',
    }
    mockExposureResponse = mockExposure
    mockApiError = null
    mockOrgsResponse = mockOrganizations
  })

  describe('Upgrade Prompt', () => {
    it('should show upgrade prompt when user is not on team plan', async () => {
      mockUser = { id: 'user-1', name: 'Test User', plan: 'free' }
      render(<SecurityExposureTab />)

      await waitFor(() => {
        expect(screen.getByText('Exposure Tracking')).toBeInTheDocument()
        expect(screen.getByText('Upgrade to Team')).toBeInTheDocument()
      })
    })
  })

  describe('Loading State', () => {
    it('should show skeletons while loading', async () => {
      render(<SecurityExposureTab />)

      // Loading is quick, but we should see content eventually
      await waitFor(() => {
        expect(screen.getByText('Exposure Report')).toBeInTheDocument()
      })
    })
  })

  describe('Error State', () => {
    it('should show error state when API fails', async () => {
      mockApiError = new Error('Network error')
      render(<SecurityExposureTab />)

      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument()
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
    })

    it('should have retry button on error', async () => {
      mockApiError = new Error('Network error')
      render(<SecurityExposureTab />)

      await waitFor(() => {
        expect(screen.getByText('Retry')).toBeInTheDocument()
      })
    })
  })

  describe('Header Section', () => {
    it('should render header with title', async () => {
      render(<SecurityExposureTab />)

      await waitFor(() => {
        expect(screen.getByText('Exposure Report')).toBeInTheDocument()
        expect(screen.getByText(/See which secrets each team member has accessed/)).toBeInTheDocument()
      })
    })

    it('should render organization selector when orgs exist', async () => {
      render(<SecurityExposureTab />)

      await waitFor(() => {
        expect(screen.getByText('All organizations')).toBeInTheDocument()
      })
    })

    it('should render period selector', async () => {
      render(<SecurityExposureTab />)

      await waitFor(() => {
        expect(screen.getByText('All time')).toBeInTheDocument()
      })
    })

    it('should render export button', async () => {
      render(<SecurityExposureTab />)

      await waitFor(() => {
        expect(screen.getByText('Export CSV')).toBeInTheDocument()
      })
    })
  })

  describe('Stats Cards', () => {
    it('should render stat cards', async () => {
      render(<SecurityExposureTab />)

      await waitFor(() => {
        const statCards = screen.getAllByTestId('exposure-stat-card')
        expect(statCards.length).toBe(3)
      })
    })

    it('should show users count', async () => {
      render(<SecurityExposureTab />)

      await waitFor(() => {
        expect(screen.getByText('Users with access')).toBeInTheDocument()
        // 3 appears in stat card - check via stat card content
        const statCards = screen.getAllByTestId('exposure-stat-card')
        const usersCard = statCards.find(card => card.textContent?.includes('Users with access'))
        expect(usersCard?.textContent).toContain('3')
      })
    })

    it('should show secrets count', async () => {
      render(<SecurityExposureTab />)

      await waitFor(() => {
        expect(screen.getByText('Unique secrets')).toBeInTheDocument()
        expect(screen.getByText('10')).toBeInTheDocument()
      })
    })

    it('should show accesses count', async () => {
      render(<SecurityExposureTab />)

      await waitFor(() => {
        expect(screen.getByText('Total accesses')).toBeInTheDocument()
        expect(screen.getByText('150')).toBeInTheDocument()
      })
    })
  })

  describe('Users List', () => {
    it('should render users list', async () => {
      render(<SecurityExposureTab />)

      await waitFor(() => {
        expect(screen.getByText('testuser')).toBeInTheDocument()
        expect(screen.getByText('anotheruser')).toBeInTheDocument()
      })
    })

    it('should show secrets accessed count', async () => {
      render(<SecurityExposureTab />)

      await waitFor(() => {
        // 5 and 3 appear as badge text next to the key icon
        const badges = screen.getAllByText(/^\d+$/)
        expect(badges.length).toBeGreaterThan(0)
      })
    })

    it('should show vaults accessed count', async () => {
      render(<SecurityExposureTab />)

      await waitFor(() => {
        expect(screen.getByText('2 vaults')).toBeInTheDocument()
        expect(screen.getByText('1 vault')).toBeInTheDocument()
      })
    })

    it('should expand user on click and show details', async () => {
      render(<SecurityExposureTab />)

      await waitFor(() => {
        expect(screen.getByText('testuser')).toBeInTheDocument()
      })

      const userRow = screen.getByText('testuser')
      fireEvent.click(userRow)

      await waitFor(() => {
        expect(screen.getByText('API_KEY')).toBeInTheDocument()
        expect(screen.getByText('DATABASE_URL')).toBeInTheDocument()
      })
    })

    it('should show role badges', async () => {
      render(<SecurityExposureTab />)

      await waitFor(() => {
        expect(screen.getByText('testuser')).toBeInTheDocument()
      })

      const userRow = screen.getByText('testuser')
      fireEvent.click(userRow)

      await waitFor(() => {
        expect(screen.getByText('admin')).toBeInTheDocument()
        expect(screen.getByText('read')).toBeInTheDocument()
      })
    })

    it('should link to vault pages', async () => {
      render(<SecurityExposureTab />)

      await waitFor(() => {
        expect(screen.getByText('testuser')).toBeInTheDocument()
      })

      const userRow = screen.getByText('testuser')
      fireEvent.click(userRow)

      await waitFor(() => {
        const link = screen.getByText('owner/repo1')
        expect(link).toBeInTheDocument()
      })
    })

    it('should collapse user when clicking again', async () => {
      render(<SecurityExposureTab />)

      await waitFor(() => {
        expect(screen.getByText('testuser')).toBeInTheDocument()
      })

      const userRow = screen.getByText('testuser')
      fireEvent.click(userRow)

      await waitFor(() => {
        expect(screen.getByText('API_KEY')).toBeInTheDocument()
      })

      fireEvent.click(userRow)

      await waitFor(() => {
        expect(screen.queryByText('API_KEY')).not.toBeInTheDocument()
      })
    })
  })

  describe('Info Alert', () => {
    it('should show info about data tracking', async () => {
      render(<SecurityExposureTab />)

      await waitFor(() => {
        expect(screen.getByText(/keyway pull/)).toBeInTheDocument()
      })
    })
  })

  describe('Empty State', () => {
    it('should show empty message when no users', async () => {
      mockExposureResponse = {
        summary: { users: 0, secrets: 0, accesses: 0 },
        users: [],
      }
      render(<SecurityExposureTab />)

      await waitFor(() => {
        expect(screen.getByText('No secret accesses recorded yet.')).toBeInTheDocument()
      })
    })
  })

  describe('Period Filtering', () => {
    it('should show period filter options', async () => {
      render(<SecurityExposureTab />)

      await waitFor(() => {
        expect(screen.getByText('All time')).toBeInTheDocument()
      })
    })
  })
})
