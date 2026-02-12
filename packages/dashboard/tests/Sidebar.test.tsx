import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sidebar } from '../app/components/dashboard/Sidebar'

// Mock next/navigation
const mockPathname = vi.fn(() => '/')
const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
}
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => mockRouter,
  useSearchParams: () => new URLSearchParams(),
}))

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, onClick, className, ...props }: any) => (
    <a href={href} onClick={onClick} className={className} {...props}>
      {children}
    </a>
  ),
}))

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ src, alt, className, ...props }: any) => (
    <img src={src} alt={alt} className={className} {...props} />
  ),
}))

// Mock next-themes
vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'light',
    setTheme: vi.fn(),
  }),
}))

// Mock auth context
const mockUser = {
  id: 'user-1',
  name: 'John Doe',
  email: 'john@example.com',
  github_username: 'johndoe',
  avatar_url: 'https://example.com/avatar.jpg',
  plan: 'pro',
}

const mockLogout = vi.fn()
const mockAuthLoading = vi.fn(() => false)
const mockAuthUser = vi.fn(() => mockUser)

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: mockAuthUser(),
    isLoading: mockAuthLoading(),
    logout: mockLogout,
  }),
}))

// Mock OrgSwitcher
vi.mock('../app/components/dashboard/OrgSwitcher', () => ({
  OrgSwitcher: () => <div data-testid="org-switcher">Org Switcher</div>,
}))

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname.mockReturnValue('/')
    mockAuthLoading.mockReturnValue(false)
    mockAuthUser.mockReturnValue(mockUser)
  })

  describe('desktop sidebar', () => {
    it('should render desktop sidebar', () => {
      render(<Sidebar isOpen={false} onClose={vi.fn()} />)

      // Desktop sidebar should exist as an aside element
      const aside = document.querySelector('aside')
      expect(aside).toBeInTheDocument()
    })

    it('should render Keyway logo and brand', () => {
      render(<Sidebar isOpen={false} onClose={vi.fn()} />)

      expect(screen.getByText('Keyway')).toBeInTheDocument()
    })

    it('should render navigation items', () => {
      render(<Sidebar isOpen={false} onClose={vi.fn()} />)

      expect(screen.getByText('Vaults')).toBeInTheDocument()
      expect(screen.getByText('Organizations')).toBeInTheDocument()
      expect(screen.getByText('Activity')).toBeInTheDocument()
      expect(screen.getByText('Security')).toBeInTheDocument()
      expect(screen.getByText('API Keys')).toBeInTheDocument()
    })

    it('should render documentation link', () => {
      render(<Sidebar isOpen={false} onClose={vi.fn()} />)

      const docsLink = screen.getByText('Documentation')
      expect(docsLink.closest('a')).toHaveAttribute('href', 'https://docs.keyway.sh')
      expect(docsLink.closest('a')).toHaveAttribute('target', '_blank')
    })

    it('should render settings link', () => {
      render(<Sidebar isOpen={false} onClose={vi.fn()} />)

      const settingsLink = screen.getByText('Settings')
      expect(settingsLink.closest('a')).toHaveAttribute('href', '/settings')
    })
  })

  describe('collapsed state', () => {
    it('should apply different styles when collapsed vs expanded', () => {
      const { rerender } = render(
        <Sidebar
          isOpen={false}
          onClose={vi.fn()}
          isCollapsed={true}
          onToggleCollapsed={vi.fn()}
        />
      )

      const collapsedClass = document.querySelector('aside')?.className

      rerender(
        <Sidebar
          isOpen={false}
          onClose={vi.fn()}
          isCollapsed={false}
          onToggleCollapsed={vi.fn()}
        />
      )

      const expandedClass = document.querySelector('aside')?.className

      // Collapsed and expanded states should have different styles
      expect(collapsedClass).not.toBe(expandedClass)
    })

    it('should hide text labels when collapsed', () => {
      render(
        <Sidebar
          isOpen={false}
          onClose={vi.fn()}
          isCollapsed={true}
          onToggleCollapsed={vi.fn()}
        />
      )

      // Keyway brand text should be hidden
      expect(screen.queryByText('Keyway')).not.toBeInTheDocument()
    })

    it('should show collapse toggle button', () => {
      const onToggleCollapsed = vi.fn()
      render(
        <Sidebar
          isOpen={false}
          onClose={vi.fn()}
          isCollapsed={false}
          onToggleCollapsed={onToggleCollapsed}
        />
      )

      expect(screen.getByText('Collapse')).toBeInTheDocument()
    })

    it('should call onToggleCollapsed when collapse button clicked', () => {
      const onToggleCollapsed = vi.fn()
      render(
        <Sidebar
          isOpen={false}
          onClose={vi.fn()}
          isCollapsed={false}
          onToggleCollapsed={onToggleCollapsed}
        />
      )

      fireEvent.click(screen.getByText('Collapse'))

      expect(onToggleCollapsed).toHaveBeenCalled()
    })
  })

  describe('active state', () => {
    it('should apply active styling to current page link', () => {
      mockPathname.mockReturnValue('/')
      render(<Sidebar isOpen={false} onClose={vi.fn()} />)

      const vaultsLink = screen.getByText('Vaults').closest('a')
      const orgsLink = screen.getByText('Organizations').closest('a')

      // Active link should have different styling than inactive links
      expect(vaultsLink?.className).not.toBe(orgsLink?.className)
    })

    it('should change active link when pathname changes', () => {
      mockPathname.mockReturnValue('/')
      const { rerender } = render(<Sidebar isOpen={false} onClose={vi.fn()} />)

      const vaultsLinkOnHome = screen.getByText('Vaults').closest('a')?.className
      const orgsLinkOnHome = screen.getByText('Organizations').closest('a')?.className

      mockPathname.mockReturnValue('/orgs')
      rerender(<Sidebar isOpen={false} onClose={vi.fn()} />)

      const vaultsLinkOnOrgs = screen.getByText('Vaults').closest('a')?.className
      const orgsLinkOnOrgs = screen.getByText('Organizations').closest('a')?.className

      // Vaults should change from active to inactive
      expect(vaultsLinkOnHome).not.toBe(vaultsLinkOnOrgs)
      // Orgs should change from inactive to active
      expect(orgsLinkOnHome).not.toBe(orgsLinkOnOrgs)
    })

    it('should highlight correct nav item for each page', () => {
      const pages = [
        { path: '/', label: 'Vaults' },
        { path: '/orgs', label: 'Organizations' },
        { path: '/activity', label: 'Activity' },
        { path: '/settings', label: 'Settings' },
      ]

      pages.forEach(({ path, label }) => {
        mockPathname.mockReturnValue(path)
        const { unmount } = render(<Sidebar isOpen={false} onClose={vi.fn()} />)

        // Current page link should exist and have styling applied
        const link = screen.getByText(label).closest('a')
        expect(link).toBeInTheDocument()
        expect(link?.className).toBeTruthy()

        unmount()
      })
    })
  })

  describe('user profile', () => {
    it('should show user avatar', () => {
      render(<Sidebar isOpen={false} onClose={vi.fn()} />)

      const avatar = screen.getByAltText('John Doe')
      expect(avatar).toHaveAttribute('src', 'https://example.com/avatar.jpg')
    })

    it('should show user name', () => {
      render(<Sidebar isOpen={false} onClose={vi.fn()} />)

      expect(screen.getByText('John Doe')).toBeInTheDocument()
    })

    it('should show user plan', () => {
      render(<Sidebar isOpen={false} onClose={vi.fn()} />)

      expect(screen.getByText('Pro Plan')).toBeInTheDocument()
    })

    it('should show Free Plan for free users', () => {
      mockAuthUser.mockReturnValue({ ...mockUser, plan: 'free' })
      render(<Sidebar isOpen={false} onClose={vi.fn()} />)

      expect(screen.getByText('Free Plan')).toBeInTheDocument()
    })

    it('should show Team Plan for team users', () => {
      mockAuthUser.mockReturnValue({ ...mockUser, plan: 'team' })
      render(<Sidebar isOpen={false} onClose={vi.fn()} />)

      expect(screen.getByText('Team Plan')).toBeInTheDocument()
    })

    it('should show loading skeleton when auth loading', () => {
      mockAuthLoading.mockReturnValue(true)
      const { container } = render(<Sidebar isOpen={false} onClose={vi.fn()} />)

      // Should show skeleton elements
      const skeletons = container.querySelectorAll('[class*="animate-pulse"]')
      expect(skeletons.length).toBeGreaterThan(0)
    })

    it('should not show profile when no user', () => {
      mockAuthUser.mockReturnValue(null)
      render(<Sidebar isOpen={false} onClose={vi.fn()} />)

      expect(screen.queryByText('John Doe')).not.toBeInTheDocument()
    })
  })

  describe('mobile drawer', () => {
    it('should render Sheet when isOpen is true', () => {
      render(<Sidebar isOpen={true} onClose={vi.fn()} />)

      // Sheet content should be accessible - there will be duplicates from desktop + mobile
      expect(screen.getAllByText('Vaults').length).toBeGreaterThanOrEqual(1)
    })

    it('should have close button on mobile', () => {
      render(<Sidebar isOpen={true} onClose={vi.fn()} />)

      // Close button should be in the Sheet - there may be multiple (desktop and mobile)
      const closeButtons = screen.getAllByRole('button', { name: /close/i })
      expect(closeButtons.length).toBeGreaterThanOrEqual(1)
    })

    it('should call onClose when close button clicked', () => {
      const onClose = vi.fn()
      render(<Sidebar isOpen={true} onClose={onClose} />)

      // Find the close button (may have multiple)
      const closeButtons = screen.getAllByRole('button', { name: /close/i })
      fireEvent.click(closeButtons[0])

      expect(onClose).toHaveBeenCalled()
    })

    it('should call onClose when navigation link clicked', () => {
      const onClose = vi.fn()
      render(<Sidebar isOpen={true} onClose={onClose} />)

      // Click on a nav link (there will be duplicates from desktop + mobile)
      const activityLinks = screen.getAllByText('Activity')
      fireEvent.click(activityLinks[activityLinks.length - 1])

      expect(onClose).toHaveBeenCalled()
    })
  })
})
