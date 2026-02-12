import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SettingsPage from '../../app/(dashboard)/settings/page'

// Mock next-themes
const mockSetTheme = vi.fn()
let mockTheme = 'system'

vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: mockTheme,
    setTheme: mockSetTheme,
  }),
}))

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// Mock auth
const mockUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  avatar_url: 'https://avatar.example.com/test.png',
  github_username: 'testuser',
}

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    user: mockUser,
    isLoading: false,
    isAuthenticated: true,
  }),
}))

// Mock analytics
vi.mock('../../lib/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    SETTINGS_VIEW: 'settings_view',
  },
}))

// Mock dashboard components
vi.mock('../../app/components/dashboard', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div data-testid="dashboard-layout">{children}</div>,
}))

// TanStack Query mocks
type SubscriptionData = {
  subscription: {
    id: string
    status: string
    currentPeriodEnd: string
    cancelAtPeriodEnd: boolean
  } | null
  plan: 'free' | 'pro' | 'team' | 'startup'
  billingStatus: 'active' | 'past_due' | 'canceled' | 'trialing'
  stripeCustomerId: string | null
}

type UsageData = {
  plan: 'free' | 'pro' | 'team' | 'startup'
  limits: {
    maxPublicRepos: string | number
    maxPrivateRepos: string | number
    maxProviders: string | number
    maxEnvironmentsPerVault: string | number
    maxSecretsPerPrivateVault: string | number
  }
  usage: {
    public: number
    private: number
    providers: number
  }
}

let mockBillingData: SubscriptionData | null = {
  subscription: null,
  plan: 'free',
  billingStatus: 'active',
  stripeCustomerId: null,
}

let mockUsageData: UsageData | null = {
  plan: 'free',
  limits: {
    maxPublicRepos: 'unlimited',
    maxPrivateRepos: 1,
    maxProviders: 1,
    maxEnvironmentsPerVault: 3,
    maxSecretsPerPrivateVault: 50,
  },
  usage: {
    public: 5,
    private: 0,
    providers: 1,
  },
}

let mockBillingLoading = false
let mockUsageLoading = false

const mockMutate = vi.fn()

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'subscription') {
      return {
        data: mockBillingLoading ? undefined : mockBillingData,
        isLoading: mockBillingLoading,
      }
    }
    if (queryKey[0] === 'usage') {
      return {
        data: mockUsageLoading ? undefined : mockUsageData,
        isLoading: mockUsageLoading,
      }
    }
    return { data: undefined, isLoading: false }
  },
  useMutation: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}))

// Mock API
vi.mock('../../lib/api', () => ({
  api: {
    getSubscription: vi.fn(),
    getUsage: vi.fn(),
    createPortalSession: vi.fn(),
  },
}))

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTheme = 'system'
    mockBillingData = {
      subscription: null,
      plan: 'free',
      billingStatus: 'active',
      stripeCustomerId: null,
    }
    mockUsageData = {
      plan: 'free',
      limits: {
        maxPublicRepos: 'unlimited',
        maxPrivateRepos: 1,
        maxProviders: 1,
        maxEnvironmentsPerVault: 3,
        maxSecretsPerPrivateVault: 50,
      },
      usage: {
        public: 5,
        private: 0,
        providers: 1,
      },
    }
    mockBillingLoading = false
    mockUsageLoading = false
  })

  describe('Page Header', () => {
    it('should render page title and description', () => {
      render(<SettingsPage />)

      expect(screen.getByText('Settings')).toBeInTheDocument()
      expect(screen.getByText('Manage your account and preferences')).toBeInTheDocument()
    })
  })

  describe('Profile Section', () => {
    it('should render GitHub Account section', () => {
      render(<SettingsPage />)

      expect(screen.getByText('GitHub Account')).toBeInTheDocument()
      expect(screen.getByText('Your account is linked to GitHub for authentication')).toBeInTheDocument()
    })

    it('should display user info', () => {
      render(<SettingsPage />)

      expect(screen.getByText('Test User')).toBeInTheDocument()
      expect(screen.getByText('@testuser')).toBeInTheDocument()
      expect(screen.getByText('GitHub OAuth')).toBeInTheDocument()
    })

    it('should have View Profile button', () => {
      render(<SettingsPage />)

      const profileLink = screen.getByText('View Profile')
      expect(profileLink.closest('a')).toHaveAttribute('href', 'https://github.com/testuser')
    })
  })

  describe('Appearance Section', () => {
    it('should render Appearance section', () => {
      render(<SettingsPage />)

      expect(screen.getByText('Appearance')).toBeInTheDocument()
      expect(screen.getByText('Customize how Keyway looks on your device')).toBeInTheDocument()
    })

    it('should render theme options', () => {
      render(<SettingsPage />)

      expect(screen.getByText('Light')).toBeInTheDocument()
      expect(screen.getByText('Dark')).toBeInTheDocument()
      expect(screen.getByText('System')).toBeInTheDocument()
    })

    it('should call setTheme when theme button is clicked', () => {
      render(<SettingsPage />)

      const darkButton = screen.getByText('Dark')
      fireEvent.click(darkButton)

      expect(mockSetTheme).toHaveBeenCalledWith('dark')
    })

    it('should call setTheme for light theme', () => {
      render(<SettingsPage />)

      const lightButton = screen.getByText('Light')
      fireEvent.click(lightButton)

      expect(mockSetTheme).toHaveBeenCalledWith('light')
    })
  })

  describe('Billing Section', () => {
    it('should render Billing section', () => {
      render(<SettingsPage />)

      expect(screen.getByText('Billing & Plan')).toBeInTheDocument()
      expect(screen.getByText('Manage your subscription and billing details')).toBeInTheDocument()
    })

    it('should show loading state for billing', () => {
      mockBillingLoading = true
      render(<SettingsPage />)

      // Should show skeletons
      expect(screen.getByTestId('dashboard-layout')).toBeInTheDocument()
    })

    it('should show Free Plan for free users', () => {
      render(<SettingsPage />)

      expect(screen.getByText('free Plan')).toBeInTheDocument()
      expect(screen.getByText('Unlimited public repos, 1 private repo')).toBeInTheDocument()
    })

    it('should show Upgrade to Pro button for free users', () => {
      render(<SettingsPage />)

      const upgradeLink = screen.getByText('Upgrade to Pro')
      expect(upgradeLink.closest('a')).toHaveAttribute('href', '/upgrade')
    })

    it('should show Pro Plan for pro users', () => {
      mockBillingData = {
        subscription: {
          id: 'sub-1',
          status: 'active',
          currentPeriodEnd: '2025-12-31T00:00:00Z',
          cancelAtPeriodEnd: false,
        },
        plan: 'pro',
        billingStatus: 'active',
        stripeCustomerId: 'cus_123',
      }
      render(<SettingsPage />)

      expect(screen.getByText('pro Plan')).toBeInTheDocument()
      expect(screen.getByText('Active')).toBeInTheDocument()
      expect(screen.getByText('$4/mo')).toBeInTheDocument()
    })

    it('should show Manage Billing button for paid users', () => {
      mockBillingData = {
        subscription: {
          id: 'sub-1',
          status: 'active',
          currentPeriodEnd: '2025-12-31T00:00:00Z',
          cancelAtPeriodEnd: false,
        },
        plan: 'pro',
        billingStatus: 'active',
        stripeCustomerId: 'cus_123',
      }
      render(<SettingsPage />)

      expect(screen.getByText('Manage Billing')).toBeInTheDocument()
    })

    it('should show renewal date for subscription', () => {
      mockBillingData = {
        subscription: {
          id: 'sub-1',
          status: 'active',
          currentPeriodEnd: '2025-12-31T00:00:00Z',
          cancelAtPeriodEnd: false,
        },
        plan: 'pro',
        billingStatus: 'active',
        stripeCustomerId: 'cus_123',
      }
      render(<SettingsPage />)

      expect(screen.getByText(/Renews on/)).toBeInTheDocument()
    })

    it('should show cancellation date when subscription is canceling', () => {
      mockBillingData = {
        subscription: {
          id: 'sub-1',
          status: 'active',
          currentPeriodEnd: '2025-12-31T00:00:00Z',
          cancelAtPeriodEnd: true,
        },
        plan: 'pro',
        billingStatus: 'active',
        stripeCustomerId: 'cus_123',
      }
      render(<SettingsPage />)

      expect(screen.getByText(/Cancels on/)).toBeInTheDocument()
    })

    it('should show Team Plan price', () => {
      mockBillingData = {
        subscription: {
          id: 'sub-1',
          status: 'active',
          currentPeriodEnd: '2025-12-31T00:00:00Z',
          cancelAtPeriodEnd: false,
        },
        plan: 'team',
        billingStatus: 'active',
        stripeCustomerId: 'cus_123',
      }
      render(<SettingsPage />)

      expect(screen.getByText('$15/mo')).toBeInTheDocument()
    })

    it('should show Past Due badge when billing is past due', () => {
      mockBillingData = {
        subscription: {
          id: 'sub-1',
          status: 'past_due',
          currentPeriodEnd: '2025-12-31T00:00:00Z',
          cancelAtPeriodEnd: false,
        },
        plan: 'pro',
        billingStatus: 'past_due',
        stripeCustomerId: 'cus_123',
      }
      render(<SettingsPage />)

      expect(screen.getByText('Past Due')).toBeInTheDocument()
    })

    it('should show Trial badge when user is trialing', () => {
      mockBillingData = {
        subscription: {
          id: 'sub-1',
          status: 'trialing',
          currentPeriodEnd: '2025-12-31T00:00:00Z',
          cancelAtPeriodEnd: false,
        },
        plan: 'pro',
        billingStatus: 'trialing',
        stripeCustomerId: 'cus_123',
      }
      render(<SettingsPage />)

      expect(screen.getByText('Trial')).toBeInTheDocument()
    })

    it('should call mutate when Manage Billing is clicked', () => {
      mockBillingData = {
        subscription: {
          id: 'sub-1',
          status: 'active',
          currentPeriodEnd: '2025-12-31T00:00:00Z',
          cancelAtPeriodEnd: false,
        },
        plan: 'pro',
        billingStatus: 'active',
        stripeCustomerId: 'cus_123',
      }
      render(<SettingsPage />)

      const manageBillingButton = screen.getByText('Manage Billing')
      fireEvent.click(manageBillingButton)

      expect(mockMutate).toHaveBeenCalled()
    })

    it('should show error message when billing data is null', () => {
      mockBillingData = null
      render(<SettingsPage />)

      expect(screen.getByText('Unable to load billing information')).toBeInTheDocument()
    })
  })

  describe('Usage Section', () => {
    it('should render Usage section', () => {
      render(<SettingsPage />)

      expect(screen.getByText('Usage')).toBeInTheDocument()
      expect(screen.getByText('Your current resource usage and plan limits')).toBeInTheDocument()
    })

    it('should show loading state for usage', () => {
      mockUsageLoading = true
      render(<SettingsPage />)

      // Should show skeletons
      expect(screen.getByTestId('dashboard-layout')).toBeInTheDocument()
    })

    it('should show usage items', () => {
      render(<SettingsPage />)

      expect(screen.getByText('Private Repositories')).toBeInTheDocument()
      expect(screen.getByText('Provider Connections')).toBeInTheDocument()
      expect(screen.getByText('Environments per Vault')).toBeInTheDocument()
      expect(screen.getByText('Secrets per Private Vault')).toBeInTheDocument()
    })

    it('should show usage values', () => {
      render(<SettingsPage />)

      // Private repos: 0/1
      expect(screen.getByText('0 / 1')).toBeInTheDocument()
      // Providers: 1/1
      expect(screen.getByText('1 / 1')).toBeInTheDocument()
    })

    it('should show error message when usage data is null', () => {
      mockUsageData = null
      render(<SettingsPage />)

      expect(screen.getByText('Unable to load usage information')).toBeInTheDocument()
    })

    it('should show descriptions for usage items', () => {
      render(<SettingsPage />)

      expect(screen.getByText('(Vercel, Netlify, etc.)')).toBeInTheDocument()
      expect(screen.getByText('(Per vault limit)')).toBeInTheDocument()
      expect(screen.getByText('(Per private vault limit)')).toBeInTheDocument()
    })
  })
})
