import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import LoginPage from '../../app/login/page'

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// Mock next/navigation
const mockPush = vi.fn()
const mockSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => mockSearchParams,
}))

// Mock logo component
vi.mock('../../app/components/logo', () => ({
  KeywayLogo: ({ className }: { className: string }) => (
    <svg data-testid="keyway-logo" className={className} />
  ),
}))

// Mock analytics
vi.mock('../../lib/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    LOGIN_PAGE_VIEW: 'login_page_view',
    LOGIN_GITHUB_CLICK: 'login_github_click',
  },
}))

// Mock auth
let mockUser: { id: string; name: string } | null = null
let mockIsLoading = false

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    user: mockUser,
    isLoading: mockIsLoading,
    isAuthenticated: !!mockUser,
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUser = null
    mockIsLoading = false
    mockSearchParams.delete('redirect')
  })

  describe('Loading State', () => {
    it('should show loading spinner when auth is loading', () => {
      mockIsLoading = true
      render(<LoginPage />)

      // Should show spinner (animate-spin class)
      const spinner = document.querySelector('.animate-spin')
      expect(spinner).toBeInTheDocument()
    })
  })

  describe('Logged Out State', () => {
    it('should render login page when not authenticated', async () => {
      render(<LoginPage />)

      await waitFor(() => {
        expect(screen.getByText('Welcome back')).toBeInTheDocument()
        expect(screen.getByText('Sign in to manage your secrets')).toBeInTheDocument()
      })
    })

    it('should render Keyway logo and name', async () => {
      render(<LoginPage />)

      await waitFor(() => {
        expect(screen.getByTestId('keyway-logo')).toBeInTheDocument()
        expect(screen.getByText('Keyway')).toBeInTheDocument()
      })
    })

    it('should render GitHub sign in button', async () => {
      render(<LoginPage />)

      await waitFor(() => {
        expect(screen.getByText('Sign in with GitHub')).toBeInTheDocument()
      })
    })

    it('should render Terms of Service link', async () => {
      render(<LoginPage />)

      await waitFor(() => {
        expect(screen.getByText('Terms of Service')).toBeInTheDocument()
      })
    })

    it('should render Learn more link', async () => {
      render(<LoginPage />)

      await waitFor(() => {
        expect(screen.getByText('Learn more')).toBeInTheDocument()
      })
    })

    it('should link home from logo', async () => {
      render(<LoginPage />)

      await waitFor(() => {
        const homeLink = screen.getByText('Keyway').closest('a')
        expect(homeLink).toHaveAttribute('href', '/')
      })
    })
  })

  describe('Logged In State', () => {
    it('should redirect to home when authenticated', async () => {
      mockUser = { id: 'user-1', name: 'Test User' }
      render(<LoginPage />)

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/')
      })
    })
  })

  describe('Redirect Handling', () => {
    it('should handle redirect query param', async () => {
      mockUser = { id: 'user-1', name: 'Test User' }
      mockSearchParams.set('redirect', '/settings')
      render(<LoginPage />)

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/settings')
      })
    })

    it('should sanitize open redirect attacks', async () => {
      mockUser = { id: 'user-1', name: 'Test User' }
      mockSearchParams.set('redirect', '//evil.com')
      render(<LoginPage />)

      // Should redirect to / instead of external URL
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/')
      })
    })
  })
})
