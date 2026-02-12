import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Container } from '../app/components/Container'

describe('Container', () => {
  it('renders children', () => {
    render(
      <Container>
        <p>Child content</p>
      </Container>
    )

    expect(screen.getByText('Child content')).toBeInTheDocument()
  })

  it('applies base container styles', () => {
    const { container } = render(<Container>Content</Container>)

    const div = container.firstChild as HTMLElement
    expect(div).toHaveClass('mx-auto', 'max-w-7xl', 'px-4')
  })

  it('applies responsive padding styles', () => {
    const { container } = render(<Container>Content</Container>)

    const div = container.firstChild as HTMLElement
    expect(div).toHaveClass('sm:px-6', 'lg:px-8')
  })

  it('merges custom className with base styles', () => {
    const { container } = render(
      <Container className="my-custom-class bg-red-500">Content</Container>
    )

    const div = container.firstChild as HTMLElement
    expect(div).toHaveClass('mx-auto', 'max-w-7xl')
    expect(div).toHaveClass('my-custom-class', 'bg-red-500')
  })

  it('passes through additional props', () => {
    render(
      <Container data-testid="test-container" id="main-container">
        Content
      </Container>
    )

    const container = screen.getByTestId('test-container')
    expect(container).toHaveAttribute('id', 'main-container')
  })

  it('renders as a div element', () => {
    const { container } = render(<Container>Content</Container>)

    expect(container.firstChild?.nodeName).toBe('DIV')
  })
})
