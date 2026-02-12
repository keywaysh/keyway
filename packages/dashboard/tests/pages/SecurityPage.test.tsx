import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import SecurityPage from '../../app/(dashboard)/security/page'

// Mock analytics
vi.mock('../../lib/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    SECURITY_TAB_CHANGE: 'security_tab_change',
  },
}))

// Mock DashboardLayout
vi.mock('../../app/components/dashboard', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Mock security tab components
vi.mock('../../app/(dashboard)/security/_components/SecurityOverviewTab', () => ({
  SecurityOverviewTab: ({ onNavigate }: { onNavigate: (tab: string) => void }) => (
    <div data-testid="overview-tab">
      Overview Tab
      <button onClick={() => onNavigate('alerts')}>Go to Alerts</button>
    </div>
  ),
}))

vi.mock('../../app/(dashboard)/security/_components/SecurityAlertsTab', () => ({
  SecurityAlertsTab: () => <div data-testid="alerts-tab">Alerts Tab</div>,
}))

vi.mock('../../app/(dashboard)/security/_components/SecurityExposureTab', () => ({
  SecurityExposureTab: () => <div data-testid="exposure-tab">Exposure Tab</div>,
}))

vi.mock('../../app/(dashboard)/security/_components/SecurityAccessLogTab', () => ({
  SecurityAccessLogTab: () => <div data-testid="access-log-tab">Access Log Tab</div>,
}))

describe('SecurityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset hash
    window.location.hash = ''
  })

  describe('Header', () => {
    it('should render page title', async () => {
      render(<SecurityPage />)

      await waitFor(() => {
        expect(screen.getByText('Security')).toBeInTheDocument()
      })
    })

    it('should render page description', async () => {
      render(<SecurityPage />)

      await waitFor(() => {
        expect(screen.getByText('Monitor security and access across all your vaults')).toBeInTheDocument()
      })
    })
  })

  describe('Tabs', () => {
    it('should render all tab triggers', async () => {
      render(<SecurityPage />)

      await waitFor(() => {
        expect(screen.getByText('Overview')).toBeInTheDocument()
        expect(screen.getByText('Alerts')).toBeInTheDocument()
        expect(screen.getByText('Exposure')).toBeInTheDocument()
        expect(screen.getByText('Access Log')).toBeInTheDocument()
      })
    })

    it('should show Overview tab by default', async () => {
      render(<SecurityPage />)

      await waitFor(() => {
        expect(screen.getByTestId('overview-tab')).toBeInTheDocument()
      })
    })

    it('should have enabled Alerts tab', async () => {
      render(<SecurityPage />)

      await waitFor(() => {
        expect(screen.getByText('Overview')).toBeInTheDocument()
      })

      const alertsTab = screen.getByRole('tab', { name: /alerts/i })
      expect(alertsTab).not.toBeDisabled()
    })

    it('should have enabled Exposure tab', async () => {
      render(<SecurityPage />)

      await waitFor(() => {
        expect(screen.getByText('Overview')).toBeInTheDocument()
      })

      const exposureTab = screen.getByRole('tab', { name: /exposure/i })
      expect(exposureTab).not.toBeDisabled()
    })

    it('should have enabled Access Log tab', async () => {
      render(<SecurityPage />)

      await waitFor(() => {
        expect(screen.getByText('Overview')).toBeInTheDocument()
      })

      const accessLogTab = screen.getByRole('tab', { name: /access log/i })
      expect(accessLogTab).not.toBeDisabled()
    })
  })

  describe('Hash Navigation', () => {
    it('should read hash on mount for deep linking', async () => {
      window.location.hash = '#alerts'
      render(<SecurityPage />)

      await waitFor(() => {
        expect(screen.getByTestId('alerts-tab')).toBeInTheDocument()
      })
    })

    it('should default to overview for invalid hash', async () => {
      window.location.hash = '#invalid'
      render(<SecurityPage />)

      await waitFor(() => {
        expect(screen.getByTestId('overview-tab')).toBeInTheDocument()
      })
    })

    it('should support exposure hash', async () => {
      window.location.hash = '#exposure'
      render(<SecurityPage />)

      await waitFor(() => {
        expect(screen.getByTestId('exposure-tab')).toBeInTheDocument()
      })
    })

    it('should support access-log hash', async () => {
      window.location.hash = '#access-log'
      render(<SecurityPage />)

      await waitFor(() => {
        expect(screen.getByTestId('access-log-tab')).toBeInTheDocument()
      })
    })
  })

  describe('Tab Navigation via onNavigate', () => {
    it('should navigate when onNavigate is called from child', async () => {
      render(<SecurityPage />)

      await waitFor(() => {
        expect(screen.getByTestId('overview-tab')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Go to Alerts'))

      await waitFor(() => {
        expect(screen.getByTestId('alerts-tab')).toBeInTheDocument()
      })
    })
  })
})
