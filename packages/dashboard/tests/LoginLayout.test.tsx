import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import LoginLayout from '../app/login/layout'

describe('LoginLayout', () => {
  it('should render children', () => {
    render(
      <LoginLayout>
        <div data-testid="child">Login Content</div>
      </LoginLayout>
    )

    expect(screen.getByTestId('child')).toBeInTheDocument()
    expect(screen.getByText('Login Content')).toBeInTheDocument()
  })

  it('should pass through children without wrapper', () => {
    const { container } = render(
      <LoginLayout>
        <span>Direct child</span>
      </LoginLayout>
    )

    expect(container.querySelector('span')).toBeInTheDocument()
    expect(screen.getByText('Direct child')).toBeInTheDocument()
  })

  it('should render multiple children', () => {
    render(
      <LoginLayout>
        <div>First</div>
        <div>Second</div>
      </LoginLayout>
    )

    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })
})
