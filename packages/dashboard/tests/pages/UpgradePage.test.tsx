import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import UpgradePage from '../../app/(dashboard)/upgrade/page'

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
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
  },
}))

// Mock auth
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      name: 'Nicolas',
      email: 'n@example.com',
      avatar_url: 'https://example.com/me.png',
      github_username: 'nicolas',
      plan: 'free',
      created_at: null,
    },
    isLoading: false,
    isAuthenticated: true,
  }),
}))

// Mock API
const mockPrices = {
  prices: {
    team: {
      monthly: { id: 'price_team_monthly', price: 1900, currency: 'eur', interval: 'month' },
      yearly: { id: 'price_team_yearly', price: 19000, currency: 'eur', interval: 'year' },
    },
    business: {
      monthly: { id: 'price_business_monthly', price: 3900, currency: 'eur', interval: 'month' },
      yearly: { id: 'price_business_yearly', price: 39000, currency: 'eur', interval: 'year' },
    },
  },
}

const mockSubscription = {
  subscription: null,
  plan: 'free' as const,
  billingStatus: 'active' as const,
  stripeCustomerId: null,
}

const mockOrgs = [
  {
    id: 'org-1',
    login: 'acme',
    display_name: 'Acme Inc',
    avatar_url: 'https://example.com/acme.png',
    plan: 'free',
    role: 'owner',
    member_count: 4,
    vault_count: 2,
    created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'org-2',
    login: 'globex',
    display_name: 'Globex',
    avatar_url: 'https://example.com/globex.png',
    plan: 'team',
    role: 'owner',
    member_count: 10,
    vault_count: 5,
    created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'org-3',
    login: 'initech',
    display_name: 'Initech',
    avatar_url: 'https://example.com/initech.png',
    plan: 'free',
    role: 'member',
    member_count: 3,
    vault_count: 1,
    created_at: '2025-01-01T00:00:00Z',
  },
]

const getOrganizations = vi.fn()
const createCheckoutSession = vi.fn()
const createOrganizationCheckoutSession = vi.fn()

vi.mock('../../lib/api', () => ({
  api: {
    getPrices: vi.fn(() => Promise.resolve(mockPrices)),
    getSubscription: vi.fn(() => Promise.resolve(mockSubscription)),
    getOrganizations: (...args: unknown[]) => getOrganizations(...args),
    createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args),
    createOrganizationCheckoutSession: (...args: unknown[]) =>
      createOrganizationCheckoutSession(...args),
  },
}))

// Mock document.cookie for login state
beforeEach(() => {
  Object.defineProperty(document, 'cookie', {
    writable: true,
    value: 'keyway_logged_in=true',
  })
})

async function openTeamMonthlyPicker() {
  render(<UpgradePage />)
  await waitFor(() => {
    expect(screen.getAllByText('Monthly').length).toBeGreaterThan(0)
  })
  // First Monthly button belongs to the Team card
  fireEvent.click(screen.getAllByText('Monthly')[0])
  await waitFor(() => {
    expect(screen.getByText('Who is this Team subscription for?')).toBeInTheDocument()
  })
}

describe('UpgradePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getOrganizations.mockResolvedValue(mockOrgs)
    createCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/personal' })
    createOrganizationCheckoutSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/org',
    })
  })

  describe('Plan Cards', () => {
    it('should render exactly Free, Team and Business (no Pro)', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('Free')).toBeInTheDocument()
        expect(screen.getByText('Team')).toBeInTheDocument()
        expect(screen.getByText('Business')).toBeInTheDocument()
        expect(screen.queryByText('Pro')).not.toBeInTheDocument()
      })
    })

    it('should render the flat-tier feature grid', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('10 private repos')).toBeInTheDocument()
        expect(screen.getByText('Unlimited private repos')).toBeInTheDocument()
        expect(
          screen.getByText('Exposure reports (secret access tracking)')
        ).toBeInTheDocument()
      })
    })

    it('should show flat prices from the API with yearly alongside', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('€19')).toBeInTheDocument()
        expect(screen.getByText('€39')).toBeInTheDocument()
        expect(screen.getByText(/€190\/year/)).toBeInTheDocument()
        expect(screen.getByText(/€390\/year/)).toBeInTheDocument()
      })
    })

    it('should fall back to default prices and a contact CTA when the API is unavailable', async () => {
      const { api } = await import('../../lib/api')
      vi.mocked(api.getPrices).mockRejectedValueOnce(new Error('down'))
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText('€19')).toBeInTheDocument()
        expect(screen.getByText('€79')).toBeInTheDocument()
        // No live price ids → checkout impossible, offer contact instead
        expect(screen.getAllByText('Contact us to upgrade')).toHaveLength(2)
        expect(screen.queryByText('Monthly')).not.toBeInTheDocument()
      })
    })

    it('should ask to log in when logged out', async () => {
      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: '',
      })
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getAllByText('Login to upgrade')).toHaveLength(2)
      })
    })
  })

  describe('Account picker (owner-as-container)', () => {
    it('should offer the personal account and each org with the right state', async () => {
      await openTeamMonthlyPicker()

      // Personal entry
      expect(screen.getByText('nicolas')).toBeInTheDocument()
      expect(screen.getByText(/covers your own repos/)).toBeInTheDocument()
      // Free owned org: selectable
      const acme = screen.getByText('Acme Inc').closest('button')
      expect(acme).not.toBeDisabled()
      // Paid org: disabled with reason
      const globex = screen.getByText('Globex').closest('button')
      expect(globex).toBeDisabled()
      expect(screen.getByText('already on team')).toBeInTheDocument()
      // Non-owner org: disabled with reason
      const initech = screen.getByText('Initech').closest('button')
      expect(initech).toBeDisabled()
      expect(screen.getByText('owners manage billing')).toBeInTheDocument()
    })

    it('should hint at connecting an org when the user has none', async () => {
      getOrganizations.mockResolvedValue([])
      await openTeamMonthlyPicker()

      expect(screen.getByText(/Have a GitHub organization\?/)).toBeInTheDocument()
      expect(screen.getByText('Connect it first').closest('a')).toHaveAttribute('href', '/orgs')
    })
  })

  describe('Named confirmation and checkout', () => {
    it('should start a personal checkout only after a named confirmation', async () => {
      await openTeamMonthlyPicker()

      fireEvent.click(screen.getByText('nicolas'))

      await waitFor(() => {
        expect(screen.getByText('Subscribe nicolas (personal) to Team?')).toBeInTheDocument()
        expect(screen.getByText(/€19\/month/)).toBeInTheDocument()
      })
      expect(createCheckoutSession).not.toHaveBeenCalled()

      fireEvent.click(screen.getByText('Continue to checkout'))

      await waitFor(() => {
        expect(createCheckoutSession).toHaveBeenCalledWith(
          'price_team_monthly',
          expect.stringContaining('/settings?upgraded=true'),
          expect.any(String)
        )
      })
      expect(createOrganizationCheckoutSession).not.toHaveBeenCalled()
    })

    it('should start an org checkout with the org-scoped URLs', async () => {
      await openTeamMonthlyPicker()

      fireEvent.click(screen.getByText('Acme Inc'))

      await waitFor(() => {
        expect(screen.getByText('Subscribe Acme Inc to Team?')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Continue to checkout'))

      await waitFor(() => {
        expect(createOrganizationCheckoutSession).toHaveBeenCalledWith(
          'acme',
          'price_team_monthly',
          expect.stringContaining('/orgs/acme/billing?success=true'),
          expect.any(String)
        )
      })
      expect(createCheckoutSession).not.toHaveBeenCalled()
    })

    it('should carry the yearly interval through the funnel', async () => {
      render(<UpgradePage />)
      await waitFor(() => {
        expect(screen.getAllByText('Yearly').length).toBeGreaterThan(0)
      })
      // Second Yearly button belongs to the Business card
      fireEvent.click(screen.getAllByText('Yearly')[1])

      await waitFor(() => {
        expect(
          screen.getByText('Who is this Business subscription for?')
        ).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('nicolas'))

      await waitFor(() => {
        expect(
          screen.getByText('Subscribe nicolas (personal) to Business?')
        ).toBeInTheDocument()
        expect(
          within(screen.getByRole('alertdialog')).getByText(/€390\/year/)
        ).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Continue to checkout'))

      await waitFor(() => {
        expect(createCheckoutSession).toHaveBeenCalledWith(
          'price_business_yearly',
          expect.any(String),
          expect.any(String)
        )
      })
    })

    it('should not start checkout when cancelled', async () => {
      await openTeamMonthlyPicker()

      fireEvent.click(screen.getByText('nicolas'))
      await waitFor(() => {
        expect(screen.getByText('Subscribe nicolas (personal) to Team?')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Cancel'))

      await waitFor(() => {
        expect(
          screen.queryByText('Subscribe nicolas (personal) to Team?')
        ).not.toBeInTheDocument()
      })
      expect(createCheckoutSession).not.toHaveBeenCalled()
      expect(createOrganizationCheckoutSession).not.toHaveBeenCalled()
    })
  })

  describe('Existing personal subscription', () => {
    it('should show the personal subscription banner', async () => {
      const { api } = await import('../../lib/api')
      vi.mocked(api.getSubscription).mockResolvedValueOnce({
        subscription: {
          id: 'sub-1',
          status: 'active',
          currentPeriodEnd: '2026-12-31T00:00:00Z',
          cancelAtPeriodEnd: false,
        },
        plan: 'team',
        billingStatus: 'active',
        stripeCustomerId: 'cus_123',
      })
      render(<UpgradePage />)

      await waitFor(() => {
        expect(screen.getByText(/Your personal account is on the/)).toBeInTheDocument()
        expect(screen.getByText('Manage your subscription in Settings')).toBeInTheDocument()
      })
    })
  })

  describe('Footer', () => {
    it('should state the owner-as-container rule', async () => {
      render(<UpgradePage />)

      await waitFor(() => {
        expect(
          screen.getByText(/A subscription covers one GitHub account/)
        ).toBeInTheDocument()
        expect(screen.getByText('Secure payments powered by Stripe')).toBeInTheDocument()
      })
    })
  })
})
