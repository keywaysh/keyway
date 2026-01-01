import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { LoadingSpinner } from '../app/components/dashboard/LoadingSpinner'

describe('LoadingSpinner', () => {
  it('renders a spinner container', () => {
    const { container } = render(<LoadingSpinner />)

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toBeInTheDocument()
    expect(wrapper).toHaveClass('flex', 'items-center', 'justify-center')
  })

  it('renders the spinning element', () => {
    const { container } = render(<LoadingSpinner />)

    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('has correct spinner styling', () => {
    const { container } = render(<LoadingSpinner />)

    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toHaveClass('w-6', 'h-6', 'rounded-full', 'border-2')
  })

  it('applies custom className to wrapper', () => {
    const { container } = render(<LoadingSpinner className="mt-4 py-8" />)

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveClass('mt-4', 'py-8')
    expect(wrapper).toHaveClass('flex', 'items-center', 'justify-center')
  })

  it('uses default empty className', () => {
    const { container } = render(<LoadingSpinner />)

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveClass('flex')
  })
})
