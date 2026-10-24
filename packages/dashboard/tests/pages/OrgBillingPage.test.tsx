import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import OrganizationBillingPage from '../../app/(dashboard)/orgs/[org]/billing/page'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useParams: () => ({ org: 'acme' }),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => '/orgs/acme/billing',
}))

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

// Mock DashboardLayout (pulls in auth/sidebar)
vi.mock('../../app/components/dashboard/Layout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Mock TrialBanner components
vi.mock('../../app/components/dashboard/TrialBanner', () => ({
  TrialBanner: () => <div data-testid="trial-banner" />,
  TrialExpiredBanner: () => <div data-testid="trial-expired-banner" />,
}))

const mockOrg = {
  id: 'org-1',
  login: 'acme',
  display_name: 'Acme Inc',
  avatar_url: 'https://example.com/acme.png',
  plan: 'free',
  role: 'owner',
  member_count: 4,
  vault_count: 2,
  created_at: '2025-01-01T00:00:00Z',
  stripe_customer_id: null,
  effective_plan: 'free',
  default_permissions: {},
  updated_at: '2025-01-01T00:00:00Z',
  trial: {
    status: 'none',
    started_at: null,
    ends_at: null,
    converted_at: null,
    days_remaining: null,
    trial_duration_days: 14,
  },
}

const mockBilling = {
  plan: 'free',
  effective_plan: 'free',
  billing_status: null,
  stripe_customer_id: null,
  subscription: null,
  trial: mockOrg.trial,
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

const createOrganizationCheckoutSession = vi.fn()

vi.mock('../../lib/api', () => ({
  api: {
    getOrganization: vi.fn(() => Promise.resolve(mockOrg)),
    getOrganizationBilling: vi.fn(() => Promise.resolve(mockBilling)),
    createOrganizationCheckoutSession: (...args: unknown[]) =>
      createOrganizationCheckoutSession(...args),
    createOrganizationPortalSession: vi.fn(),
    startOrganizationTrial: vi.fn(),
  },
}))

describe('OrganizationBillingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createOrganizationCheckoutSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/session/123',
    })
  })

  it('should render plan cards with flat prices', async () => {
    render(<OrganizationBillingPage />)

    await waitFor(() => {
      expect(screen.getByText('Choose a plan')).toBeInTheDocument()
      expect(screen.getByText('€19')).toBeInTheDocument()
      expect(screen.getByText('€39')).toBeInTheDocument()
    })
  })

  it('should list the updated Free plan limit', async () => {
    render(<OrganizationBillingPage />)

    await waitFor(() => {
      expect(screen.getByText('10 private repositories')).toBeInTheDocument()
    })
  })

  describe('Named checkout confirmation', () => {
    it('should name the organization, plan and price before checkout', async () => {
      render(<OrganizationBillingPage />)

      await waitFor(() => {
        expect(screen.getByText('Choose a plan')).toBeInTheDocument()
      })

      // First card is Team; click its Monthly button
      fireEvent.click(screen.getAllByText('Monthly')[0])

      await waitFor(() => {
        expect(screen.getByText('Subscribe Acme Inc to Team?')).toBeInTheDocument()
        expect(screen.getByText(/€19\/month/)).toBeInTheDocument()
        expect(screen.getByText(/unlimited members/)).toBeInTheDocument()
      })

      // No checkout before confirmation
      expect(createOrganizationCheckoutSession).not.toHaveBeenCalled()
    })

    it('should start checkout only after confirmation', async () => {
      render(<OrganizationBillingPage />)

      await waitFor(() => {
        expect(screen.getByText('Choose a plan')).toBeInTheDocument()
      })

      fireEvent.click(screen.getAllByText('Yearly')[0])

      await waitFor(() => {
        expect(screen.getByText('Subscribe Acme Inc to Team?')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Continue to checkout'))

      await waitFor(() => {
        expect(createOrganizationCheckoutSession).toHaveBeenCalledWith(
          'acme',
          'price_team_yearly',
          expect.stringContaining('/orgs/acme/billing'),
          expect.stringContaining('/orgs/acme/billing')
        )
      })
    })

    it('should not start checkout when cancelled', async () => {
      render(<OrganizationBillingPage />)

      await waitFor(() => {
        expect(screen.getByText('Choose a plan')).toBeInTheDocument()
      })

      fireEvent.click(screen.getAllByText('Monthly')[1]) // Business card

      await waitFor(() => {
        expect(screen.getByText('Subscribe Acme Inc to Business?')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Cancel'))

      await waitFor(() => {
        expect(
          screen.queryByText('Subscribe Acme Inc to Business?')
        ).not.toBeInTheDocument()
      })
      expect(createOrganizationCheckoutSession).not.toHaveBeenCalled()
    })
  })
})
