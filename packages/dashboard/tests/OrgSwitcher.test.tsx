import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OrgSwitcher, OrgSwitcherSkeleton } from '../app/components/dashboard/OrgSwitcher'

// Mock dependencies
const mockPush = vi.fn()
const mockPathname = '/'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: () => mockPathname,
}))

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
      avatar_url: 'https://example.com/avatar.png',
      github_username: 'testuser',
    },
  }),
}))

vi.mock('@/lib/api', () => ({
  api: {
    getOrganizations: vi.fn(),
  },
}))

vi.mock('@/lib/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    ORG_SWITCH: 'org_switch',
  },
}))

import { api } from '@/lib/api'

const mockOrganizations = [
  {
    id: 'org-1',
    login: 'acme-corp',
    display_name: 'ACME Corporation',
    avatar_url: 'https://example.com/acme.png',
    plan: 'team',
    is_admin: true,
    member_count: 10,
    created_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 'org-2',
    login: 'startup-inc',
    display_name: 'Startup Inc',
    avatar_url: 'https://example.com/startup.png',
    plan: 'free',
    is_admin: false,
    member_count: 3,
    created_at: '2025-01-01T00:00:00Z',
  },
]

describe('OrgSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(api.getOrganizations).mockResolvedValue(mockOrganizations)
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('loading state', () => {
    it('should show skeleton while loading', () => {
      // Make API hang
      vi.mocked(api.getOrganizations).mockImplementation(() => new Promise(() => {}))

      render(<OrgSwitcher />)

      expect(screen.getByTestId ? screen.queryByRole('button') : null).toBeNull()
    })
  })

  describe('no organizations', () => {
    it('should not render when no organizations exist', async () => {
      vi.mocked(api.getOrganizations).mockResolvedValue([])

      const { container } = render(<OrgSwitcher />)

      await waitFor(() => {
        expect(container.firstChild).toBeNull()
      })
    })
  })

  describe('with organizations', () => {
    it('should render when organizations exist', async () => {
      render(<OrgSwitcher />)

      await waitFor(() => {
        expect(screen.getByText('Test User')).toBeInTheDocument()
      })
      expect(screen.getByText('Personal account')).toBeInTheDocument()
    })

    it('should show dropdown with organizations when clicked', async () => {
      const user = userEvent.setup()
      render(<OrgSwitcher />)

      await waitFor(() => {
        expect(screen.getByText('Test User')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(screen.getByText('Personal Account')).toBeInTheDocument()
        expect(screen.getByText('Organizations')).toBeInTheDocument()
        expect(screen.getByText('ACME Corporation')).toBeInTheDocument()
        expect(screen.getByText('Startup Inc')).toBeInTheDocument()
      })
    })

    it('should show Team badge for team plan organizations', async () => {
      const user = userEvent.setup()
      render(<OrgSwitcher />)

      await waitFor(() => {
        expect(screen.getByText('Test User')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(screen.getByText('Team')).toBeInTheDocument()
      })
    })
  })

  describe('context switching', () => {
    it('should switch to organization and navigate', async () => {
      const user = userEvent.setup()
      const mockOnContextChange = vi.fn()

      render(<OrgSwitcher onContextChange={mockOnContextChange} />)

      await waitFor(() => {
        expect(screen.getByText('Test User')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(screen.getByText('ACME Corporation')).toBeInTheDocument()
      })

      await user.click(screen.getByText('ACME Corporation'))

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/orgs/acme-corp')
        expect(mockOnContextChange).toHaveBeenCalledWith({
          type: 'organization',
          id: 'org-1',
          login: 'acme-corp',
        })
      })
    })

    it('should switch to personal and navigate', async () => {
      const user = userEvent.setup()

      // Start with org context stored
      localStorage.setItem('keyway_org_context', JSON.stringify({
        type: 'organization',
        id: 'org-1',
        login: 'acme-corp',
      }))

      render(<OrgSwitcher />)

      await waitFor(() => {
        expect(screen.getByText('ACME Corporation')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button'))

      // Find the Personal menu item (not the label)
      const menuItems = await screen.findAllByRole('menuitem')
      const personalItem = menuItems.find(item => item.textContent?.includes('Test User'))
      if (personalItem) {
        await user.click(personalItem)
      }

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/')
      })
    })
  })

  describe('persistence', () => {
    it('should restore context from localStorage', async () => {
      localStorage.setItem('keyway_org_context', JSON.stringify({
        type: 'organization',
        id: 'org-1',
        login: 'acme-corp',
      }))

      render(<OrgSwitcher />)

      await waitFor(() => {
        expect(screen.getByText('ACME Corporation')).toBeInTheDocument()
        expect(screen.getByText('Organization')).toBeInTheDocument()
      })
    })

    it('should fallback to personal if stored org no longer exists', async () => {
      localStorage.setItem('keyway_org_context', JSON.stringify({
        type: 'organization',
        id: 'deleted-org',
        login: 'deleted',
      }))

      render(<OrgSwitcher />)

      await waitFor(() => {
        expect(screen.getByText('Test User')).toBeInTheDocument()
        expect(screen.getByText('Personal account')).toBeInTheDocument()
      })
    })
  })

  describe('API error handling', () => {
    it('should handle API error gracefully', async () => {
      vi.mocked(api.getOrganizations).mockRejectedValue(new Error('Network error'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { container } = render(<OrgSwitcher />)

      await waitFor(() => {
        expect(container.firstChild).toBeNull()
      })

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })
})

describe('OrgSwitcherSkeleton', () => {
  it('should render skeleton UI', () => {
    const { container } = render(<OrgSwitcherSkeleton />)

    // Skeleton should have elements
    expect(container.firstChild).toBeTruthy()
    expect(container.querySelector('.px-3')).toBeInTheDocument()
  })
})
