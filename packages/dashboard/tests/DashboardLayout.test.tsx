import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AppLayout from '../app/(dashboard)/layout'

// Mock AuthProvider
vi.mock('../lib/auth', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="auth-provider">{children}</div>
  ),
}))

describe('AppLayout (Dashboard)', () => {
  it('should wrap children with AuthProvider', () => {
    render(
      <AppLayout>
        <div data-testid="child">Dashboard Content</div>
      </AppLayout>
    )

    expect(screen.getByTestId('auth-provider')).toBeInTheDocument()
    expect(screen.getByTestId('child')).toBeInTheDocument()
    expect(screen.getByText('Dashboard Content')).toBeInTheDocument()
  })

  it('should render children inside AuthProvider', () => {
    render(
      <AppLayout>
        <span>Nested Content</span>
      </AppLayout>
    )

    const authProvider = screen.getByTestId('auth-provider')
    expect(authProvider).toContainElement(screen.getByText('Nested Content'))
  })

  it('should support multiple children', () => {
    render(
      <AppLayout>
        <div>First</div>
        <div>Second</div>
      </AppLayout>
    )

    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })
})
