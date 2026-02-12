import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SecurityAlertsTab } from '../../app/(dashboard)/security/_components/SecurityAlertsTab'
import type { SecurityAlert } from '../../lib/types'

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
    SECURITY_ALERTS_VIEW: 'security_alerts_view',
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

const mockAlerts: SecurityAlert[] = [
  {
    id: 'alert-1',
    type: 'impossible_travel',
    message: 'Access from New York and Tokyo within 30 minutes',
    createdAt: new Date().toISOString(),
    vault: {
      id: 'vault-1',
      repoFullName: 'owner/repo1',
    },
    event: {
      ip: '192.168.1.1',
      location: {
        city: 'New York',
        country: 'US',
      },
    },
  },
  {
    id: 'alert-2',
    type: 'new_device',
    message: 'First access from iPhone Safari',
    createdAt: new Date(Date.now() - 86400000).toISOString(), // Yesterday
    vault: {
      id: 'vault-2',
      repoFullName: 'owner/repo2',
    },
    event: {
      ip: '10.0.0.1',
      location: {
        city: 'London',
        country: 'UK',
      },
    },
  },
  {
    id: 'alert-3',
    type: 'rate_anomaly',
    message: '500 requests in 1 minute',
    createdAt: new Date().toISOString(),
    vault: null,
    event: {
      ip: '172.16.0.1',
      location: null,
    },
  },
]

let mockApiResponse: SecurityAlert[] = mockAlerts
let mockApiError: Error | null = null

vi.mock('../../lib/api', () => ({
  api: {
    getMySecurityAlerts: vi.fn(() => {
      if (mockApiError) throw mockApiError
      return Promise.resolve(mockApiResponse)
    }),
  },
}))

describe('SecurityAlertsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiResponse = mockAlerts
    mockApiError = null
  })

  describe('Stats Cards', () => {
    it('should render stat cards', async () => {
      render(<SecurityAlertsTab />)

      await waitFor(() => {
        expect(screen.getByText('Total Alerts')).toBeInTheDocument()
        expect(screen.getByText('Critical')).toBeInTheDocument()
        expect(screen.getByText('Today')).toBeInTheDocument()
      })
    })

    it('should show correct total count', async () => {
      render(<SecurityAlertsTab />)

      await waitFor(() => {
        // Total Alerts should show 3
        const totalCard = screen.getByText('Total Alerts').closest('div')
        expect(totalCard?.textContent).toContain('3')
      })
    })

    it('should calculate critical alerts correctly', async () => {
      render(<SecurityAlertsTab />)

      await waitFor(() => {
        // impossible_travel and rate_anomaly are critical
        const criticalCard = screen.getByText('Critical').closest('div')
        expect(criticalCard?.textContent).toContain('2')
      })
    })
  })

  describe('Error State', () => {
    it('should show error state when API fails', async () => {
      mockApiError = new Error('Network error')
      render(<SecurityAlertsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument()
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
    })

    it('should have retry button', async () => {
      mockApiError = new Error('Network error')
      render(<SecurityAlertsTab />)

      await waitFor(() => {
        expect(screen.getByText('Retry')).toBeInTheDocument()
      })
    })
  })

  describe('Empty State', () => {
    it('should show empty state when no alerts', async () => {
      mockApiResponse = []
      render(<SecurityAlertsTab />)

      await waitFor(() => {
        expect(screen.getByTestId('empty-state')).toBeInTheDocument()
        expect(screen.getByText('No security alerts')).toBeInTheDocument()
      })
    })
  })

  describe('Alert List', () => {
    it('should render alerts grouped by date', async () => {
      render(<SecurityAlertsTab />)

      await waitFor(() => {
        // Find date headers (h3 elements)
        const todayHeaders = screen.getAllByText('Today')
        expect(todayHeaders.length).toBeGreaterThan(0)
        expect(screen.getByText('Yesterday')).toBeInTheDocument()
      })
    })

    it('should show alert type labels', async () => {
      render(<SecurityAlertsTab />)

      await waitFor(() => {
        expect(screen.getByText('Impossible Travel')).toBeInTheDocument()
        expect(screen.getByText('New Device')).toBeInTheDocument()
        expect(screen.getByText('Unusual Activity')).toBeInTheDocument()
      })
    })

    it('should show severity badges', async () => {
      render(<SecurityAlertsTab />)

      await waitFor(() => {
        expect(screen.getAllByText('critical').length).toBeGreaterThan(0)
        expect(screen.getAllByText('warning').length).toBeGreaterThan(0)
      })
    })

    it('should show alert messages', async () => {
      render(<SecurityAlertsTab />)

      await waitFor(() => {
        expect(screen.getByText('Access from New York and Tokyo within 30 minutes')).toBeInTheDocument()
        expect(screen.getByText('First access from iPhone Safari')).toBeInTheDocument()
      })
    })

    it('should link to vault pages', async () => {
      render(<SecurityAlertsTab />)

      await waitFor(() => {
        const link = screen.getByText('owner/repo1')
        expect(link.closest('a')).toHaveAttribute('href', '/vaults/owner/repo1')
      })
    })

    it('should show IP addresses', async () => {
      render(<SecurityAlertsTab />)

      await waitFor(() => {
        expect(screen.getByText('192.168.1.1')).toBeInTheDocument()
        expect(screen.getByText('10.0.0.1')).toBeInTheDocument()
      })
    })

    it('should show locations', async () => {
      render(<SecurityAlertsTab />)

      await waitFor(() => {
        expect(screen.getByText('New York, US')).toBeInTheDocument()
        expect(screen.getByText('London, UK')).toBeInTheDocument()
      })
    })

    it('should show Unknown location when location is null', async () => {
      render(<SecurityAlertsTab />)

      await waitFor(() => {
        expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0)
      })
    })
  })
})
