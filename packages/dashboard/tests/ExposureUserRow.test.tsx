import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExposureUserRow, ExposureUserRowSkeleton } from '../app/components/dashboard/ExposureUserRow'
import type { ExposureUserReport, ExposureUserSummary } from '../lib/types'

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// Mock date-utils
vi.mock('../lib/date-utils', () => ({
  formatRelativeTime: (date: string) => `2 days ago (${date.slice(0, 10)})`,
}))

describe('ExposureUserRow', () => {
  const mockUser: ExposureUserSummary = {
    user: {
      username: 'testuser',
      avatarUrl: 'https://avatar.example.com/testuser.png',
    },
    secretsAccessed: 15,
    vaultsAccessed: 3,
    lastAccess: '2025-01-01T12:00:00Z',
  }

  const mockUserReport: ExposureUserReport = {
    user: {
      username: 'testuser',
      avatarUrl: 'https://avatar.example.com/testuser.png',
    },
    vaults: [
      {
        repoFullName: 'owner/repo',
        secrets: [
          {
            key: 'API_KEY',
            environment: 'production',
            roleAtAccess: 'admin',
            accessCount: 5,
            lastAccess: '2025-01-01T12:00:00Z',
          },
          {
            key: 'DATABASE_URL',
            environment: 'staging',
            roleAtAccess: 'write',
            accessCount: 3,
            lastAccess: '2024-12-28T12:00:00Z',
          },
        ],
      },
    ],
  }

  const defaultProps = {
    user: mockUser,
    orgLogin: 'acme',
    isExpanded: false,
    onToggle: vi.fn(),
    userReport: null,
    isLoadingReport: false,
  }

  it('should render user info', () => {
    render(<ExposureUserRow {...defaultProps} />)

    expect(screen.getByText('testuser')).toBeInTheDocument()
    expect(screen.getByText(/Last access:/)).toBeInTheDocument()
  })

  it('should show secrets count badge', () => {
    render(<ExposureUserRow {...defaultProps} />)

    expect(screen.getByText('15')).toBeInTheDocument()
  })

  it('should show vaults count singular', () => {
    render(<ExposureUserRow {...defaultProps} user={{ ...mockUser, vaultsAccessed: 1 }} />)

    expect(screen.getByText('1 vault')).toBeInTheDocument()
  })

  it('should show vaults count plural', () => {
    render(<ExposureUserRow {...defaultProps} />)

    expect(screen.getByText('3 vaults')).toBeInTheDocument()
  })

  it('should call onToggle when clicked', () => {
    const onToggle = vi.fn()
    render(<ExposureUserRow {...defaultProps} onToggle={onToggle} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('should show loading state when expanded and loading', () => {
    render(<ExposureUserRow {...defaultProps} isExpanded={true} isLoadingReport={true} />)

    // Skeleton elements should be present
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  })

  it('should show user report when expanded', () => {
    render(
      <ExposureUserRow
        {...defaultProps}
        isExpanded={true}
        userReport={mockUserReport}
      />
    )

    expect(screen.getByText('owner/repo')).toBeInTheDocument()
    expect(screen.getByText('API_KEY')).toBeInTheDocument()
    expect(screen.getByText('DATABASE_URL')).toBeInTheDocument()
    expect(screen.getByText('production')).toBeInTheDocument()
    expect(screen.getByText('staging')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('write')).toBeInTheDocument()
  })

  it('should show "No detailed data available" when expanded with no report', () => {
    render(
      <ExposureUserRow
        {...defaultProps}
        isExpanded={true}
        userReport={null}
        isLoadingReport={false}
      />
    )

    expect(screen.getByText('No detailed data available')).toBeInTheDocument()
  })

  it('should link to vault page', () => {
    render(
      <ExposureUserRow
        {...defaultProps}
        isExpanded={true}
        userReport={mockUserReport}
      />
    )

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/vaults/owner/repo')
  })

  it('should render avatar with fallback', () => {
    render(<ExposureUserRow {...defaultProps} user={{ ...mockUser, user: { ...mockUser.user, avatarUrl: null } }} />)

    expect(screen.getByText('T')).toBeInTheDocument() // First letter of testuser
  })

  it('should show access count in report', () => {
    render(
      <ExposureUserRow
        {...defaultProps}
        isExpanded={true}
        userReport={mockUserReport}
      />
    )

    expect(screen.getByText(/5×/)).toBeInTheDocument()
    expect(screen.getByText(/3×/)).toBeInTheDocument()
  })
})

describe('ExposureUserRowSkeleton', () => {
  it('should render skeleton elements', () => {
    const { container } = render(<ExposureUserRowSkeleton />)

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
  })
})
