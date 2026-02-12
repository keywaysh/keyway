import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TrialBanner, TrialExpiredBanner } from '../app/components/dashboard/TrialBanner'
import type { TrialInfo } from '../lib/types'

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

describe('TrialBanner', () => {
  const createTrial = (overrides?: Partial<TrialInfo>): TrialInfo => ({
    status: 'active',
    started_at: '2025-01-01T00:00:00Z',
    ends_at: '2025-01-16T00:00:00Z',
    converted_at: null,
    days_remaining: 10,
    trial_duration_days: 15,
    ...overrides,
  })

  it('should render with days remaining', () => {
    render(<TrialBanner trial={createTrial()} orgLogin="acme" />)

    expect(screen.getByText('10 days remaining in your Team trial')).toBeInTheDocument()
    expect(screen.getByText('Upgrade Now')).toBeInTheDocument()
  })

  it('should show urgent message when 3 days or less', () => {
    render(<TrialBanner trial={createTrial({ days_remaining: 3 })} orgLogin="acme" />)

    expect(screen.getByText('Only 3 days left in your Team trial')).toBeInTheDocument()
  })

  it('should show last day message when 1 day remaining', () => {
    render(<TrialBanner trial={createTrial({ days_remaining: 1 })} orgLogin="acme" />)

    expect(screen.getByText('Last day of your Team trial!')).toBeInTheDocument()
    expect(screen.getByText('Upgrade now to keep all Team features')).toBeInTheDocument()
  })

  it('should show last day message when 0 days remaining', () => {
    render(<TrialBanner trial={createTrial({ days_remaining: 0 })} orgLogin="acme" />)

    expect(screen.getByText('Last day of your Team trial!')).toBeInTheDocument()
  })

  it('should handle null days_remaining', () => {
    render(<TrialBanner trial={createTrial({ days_remaining: null })} orgLogin="acme" />)

    expect(screen.getByText('Last day of your Team trial!')).toBeInTheDocument()
  })

  it('should not render when trial is not active', () => {
    render(<TrialBanner trial={createTrial({ status: 'expired' })} orgLogin="acme" />)

    expect(screen.queryByText('Team trial')).not.toBeInTheDocument()
  })

  it('should not render when trial status is none', () => {
    render(<TrialBanner trial={createTrial({ status: 'none' })} orgLogin="acme" />)

    expect(screen.queryByText('Team trial')).not.toBeInTheDocument()
  })

  it('should link to org billing page', () => {
    render(<TrialBanner trial={createTrial()} orgLogin="acme" />)

    const link = screen.getByRole('link', { name: /Upgrade Now/i })
    expect(link).toHaveAttribute('href', '/orgs/acme/billing')
  })

  it('should be dismissable by default', () => {
    render(<TrialBanner trial={createTrial()} orgLogin="acme" />)

    const dismissButton = screen.getByRole('button', { name: /Dismiss/i })
    expect(dismissButton).toBeInTheDocument()

    fireEvent.click(dismissButton)

    expect(screen.queryByText('Team trial')).not.toBeInTheDocument()
  })

  it('should not show dismiss button when dismissable=false', () => {
    render(<TrialBanner trial={createTrial()} orgLogin="acme" dismissable={false} />)

    expect(screen.queryByRole('button', { name: /Dismiss/i })).not.toBeInTheDocument()
  })

  it('should apply custom className', () => {
    const { container } = render(
      <TrialBanner trial={createTrial()} orgLogin="acme" className="custom-class" />
    )

    expect(container.firstChild).toHaveClass('custom-class')
  })
})

describe('TrialExpiredBanner', () => {
  it('should render expired message', () => {
    render(<TrialExpiredBanner orgLogin="acme" />)

    expect(screen.getByText('Your Team trial has ended')).toBeInTheDocument()
    expect(screen.getByText('Upgrade to restore unlimited repos, environments, and secrets')).toBeInTheDocument()
  })

  it('should link to org billing page', () => {
    render(<TrialExpiredBanner orgLogin="acme" />)

    const link = screen.getByRole('link', { name: /Upgrade to Team/i })
    expect(link).toHaveAttribute('href', '/orgs/acme/billing')
  })

  it('should apply custom className', () => {
    const { container } = render(<TrialExpiredBanner orgLogin="acme" className="custom-class" />)

    expect(container.firstChild).toHaveClass('custom-class')
  })
})
