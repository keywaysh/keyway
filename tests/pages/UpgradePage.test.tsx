import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import UpgradePage from '../../app/(dashboard)/upgrade/page'

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
    UPGRADE_VIEW: 'upgrade_view',
    UPGRADE_CLICK: 'upgrade_click',
    UPGRADE_INTERVAL_CHANGE: 'upgrade_interval_change',
  },
}))

// Mock API
const mockPrices = {
  prices: {
    pro: {
      monthly: { id: 'price_pro_monthly', price: 400, interval: 'month' },
      yearly: { id: 'price_pro_yearly', price: 4000, interval: 'year' },
    },
    team: {
      monthly: { id: 'price_team_monthly', price: 1500, interval: 'month' },
      yearly: { id: 'price_team_yearly', price: 15000, interval: 'year' },
    },
    startup: {
      monthly: { id: 'price_startup_monthly', price: 3900, interval: 'month' },
      yearly: { id: 'price_startup_yearly', price: 39000, interval: 'year' },
    },
  },
}

const mockSubscription = {
  subscription: null,
  plan: 'free' as const,
  billingStatus: 'active' as const,
  stripeCustomerId: null,
}

vi.mock('../../lib/api', () => ({
  api: {
    getPrices: vi.fn(() => Promise.resolve(mockPrices)),
    getSubscription: vi.fn(() => Promise.resolve(mockSubscription)),
    createCheckoutSession: vi.fn(),
  },
}))

// Mock document.cookie for login state
const originalCookie = document.cookie
beforeEach(() => {
  Object.defineProperty(document, 'cookie', {
    writable: true,
    value: 'keyway_logged_in=true',
  })
})

describe('UpgradePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Header', () => {
    it('should render Keyway logo and name', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('Keyway')).toBeInTheDocument()
      })
    })

    it('should render page title', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('Upgrade your plan')).toBeInTheDocument()
      })
    })

    it('should show Dashboard link when logged in', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('Dashboard')).toBeInTheDocument()
      })
    })
  })

  describe('Billing Toggle', () => {
    it('should render monthly and yearly options', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('Monthly')).toBeInTheDocument()
        expect(screen.getByText('Yearly')).toBeInTheDocument()
      })
    })

    it('should show save discount on yearly', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('Save 17%')).toBeInTheDocument()
      })
    })
  })

  describe('Plan Cards', () => {
    it('should render Free plan card', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('Free')).toBeInTheDocument()
        expect(screen.getByText('For personal projects')).toBeInTheDocument()
        expect(screen.getByText('$0')).toBeInTheDocument()
      })
    })

    it('should render Pro plan card', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('Pro')).toBeInTheDocument()
        expect(screen.getByText('For professionals & small teams')).toBeInTheDocument()
        expect(screen.getByText('Most popular')).toBeInTheDocument()
      })
    })

    it('should render Team plan card', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('Team')).toBeInTheDocument()
        expect(screen.getByText('Audit logs & access control')).toBeInTheDocument()
        expect(screen.getByText('Collaboration')).toBeInTheDocument()
      })
    })

    it('should render Startup plan card', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('Startup')).toBeInTheDocument()
        expect(screen.getByText('40 repos & priority support')).toBeInTheDocument()
        expect(screen.getByText('Best value')).toBeInTheDocument()
      })
    })

    it('should render Free plan features', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('Unlimited public repos')).toBeInTheDocument()
        expect(screen.getByText('1 private repo')).toBeInTheDocument()
        expect(screen.getByText('2 provider integrations')).toBeInTheDocument()
      })
    })

    it('should render Pro plan features', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('5 private repos')).toBeInTheDocument()
        // "Unlimited environments" and "Unlimited providers" appear in Pro, Team, and Startup plans
        expect(screen.getAllByText('Unlimited environments').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText('Unlimited providers').length).toBeGreaterThanOrEqual(1)
      })
    })

    it('should render Team plan features', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('10 private repos')).toBeInTheDocument()
        expect(screen.getByText('Audit logs')).toBeInTheDocument()
      })
    })

    it('should render Startup plan features', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('40 private repos')).toBeInTheDocument()
        expect(screen.getByText('30 collaborators per repo')).toBeInTheDocument()
        expect(screen.getByText('Priority support')).toBeInTheDocument()
      })
    })
  })

  describe('Pricing Display', () => {
    it('should show monthly prices by default', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('$4')).toBeInTheDocument()
        expect(screen.getByText('$15')).toBeInTheDocument()
        expect(screen.getByText('$39')).toBeInTheDocument()
      })
    })

    it('should have yearly billing toggle', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        const yearlyButton = screen.getByText('Yearly')
        expect(yearlyButton).toBeInTheDocument()
        // Button should be clickable
        expect(yearlyButton).not.toBeDisabled()
      })
    })
  })

  describe('Upgrade Buttons', () => {
    it('should render upgrade to Pro button', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument()
      })
    })

    it('should render upgrade to Team button', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('Upgrade to Team')).toBeInTheDocument()
      })
    })

    it('should render upgrade to Startup button', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('Upgrade to Startup')).toBeInTheDocument()
      })
    })

    it('should show Current plan for free users', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('Current plan')).toBeInTheDocument()
      })
    })
  })

  describe('Footer', () => {
    it('should render Stripe mention', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('Secure payments powered by Stripe')).toBeInTheDocument()
      })
    })

    it('should render cancel anytime text', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText(/Cancel anytime/)).toBeInTheDocument()
      })
    })

    it('should render contact link', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        const contactLinks = screen.getAllByText('Contact us')
        expect(contactLinks.length).toBeGreaterThan(0)
      })
    })

    it('should render billing scope clarification', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText(/Plans are per-account/)).toBeInTheDocument()
      })
    })
  })
})
