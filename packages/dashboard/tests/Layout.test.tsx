import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DashboardLayout } from '../app/components/dashboard/Layout'

// Mock dependencies
const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: () => '/',
}))

const mockUseAuth = vi.fn()

vi.mock('@/lib/auth', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
}))

// Mock child components
vi.mock('../app/components/dashboard/Sidebar', () => ({
  Sidebar: ({ isOpen, isCollapsed }: { isOpen: boolean; isCollapsed: boolean }) => (
    <nav data-testid="sidebar" data-open={isOpen} data-collapsed={isCollapsed}>
      Sidebar
    </nav>
  ),
}))

vi.mock('../app/components/dashboard/Topbar', () => ({
  Topbar: ({ onMenuClick }: { onMenuClick: () => void }) => (
    <header data-testid="topbar">
      <button onClick={onMenuClick}>Menu</button>
    </header>
  ),
}))

vi.mock('../app/components/dashboard/LoadingSpinner', () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner">Loading...</div>,
}))

const mockUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  avatar_url: 'https://example.com/avatar.png',
  github_username: 'testuser',
}

describe('DashboardLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockUseAuth.mockReturnValue({
      user: mockUser,
      isLoading: false,
      error: null,
    })
  })

  describe('loading state', () => {
    it('should show loading spinner when loading', () => {
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: true,
        error: null,
      })

      render(<DashboardLayout>Content</DashboardLayout>)

      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
    })
  })

  describe('authentication redirect', () => {
    it('should redirect to login when not authenticated', async () => {
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
        error: null,
      })

      render(<DashboardLayout>Content</DashboardLayout>)

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/login')
      })
    })

    it('should not redirect when user is authenticated', () => {
      render(<DashboardLayout>Content</DashboardLayout>)

      expect(mockPush).not.toHaveBeenCalled()
    })
  })

  describe('error state', () => {
    it('should show error message when session error occurs', () => {
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
        error: 'Session expired',
      })

      render(<DashboardLayout>Content</DashboardLayout>)

      expect(screen.getByText('Session expired')).toBeInTheDocument()
      expect(screen.getByText(/Your session has expired/)).toBeInTheDocument()
    })

    it('should show countdown timer', () => {
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
        error: 'Session expired',
      })

      render(<DashboardLayout>Content</DashboardLayout>)

      expect(screen.getByText(/Redirecting to home in \d+s/)).toBeInTheDocument()
    })
  })

  describe('authenticated state', () => {
    it('should render sidebar and topbar when authenticated', () => {
      render(<DashboardLayout>Content</DashboardLayout>)

      expect(screen.getByTestId('sidebar')).toBeInTheDocument()
      expect(screen.getByTestId('topbar')).toBeInTheDocument()
    })

    it('should render children content', () => {
      render(<DashboardLayout><div>Dashboard Content</div></DashboardLayout>)

      expect(screen.getByText('Dashboard Content')).toBeInTheDocument()
    })
  })

  describe('sidebar interactions', () => {
    it('should open sidebar when menu clicked', async () => {
      const user = userEvent.setup()
      render(<DashboardLayout>Content</DashboardLayout>)

      const menuButton = screen.getByRole('button', { name: 'Menu' })
      await user.click(menuButton)

      const sidebar = screen.getByTestId('sidebar')
      expect(sidebar).toHaveAttribute('data-open', 'true')
    })

    it('should persist collapsed state to localStorage', async () => {
      localStorage.setItem('keyway_sidebar_collapsed', 'true')

      render(<DashboardLayout>Content</DashboardLayout>)

      await waitFor(() => {
        const sidebar = screen.getByTestId('sidebar')
        expect(sidebar).toHaveAttribute('data-collapsed', 'true')
      })
    })
  })

  describe('no user state', () => {
    it('should render null when no user and no error', () => {
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
        error: null,
      })

      const { container } = render(<DashboardLayout>Content</DashboardLayout>)

      // Component should render nothing (redirect will happen)
      expect(container.firstChild).toBeNull()
    })
  })
})
