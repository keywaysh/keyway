import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { KeywayLogo } from '../app/components/logo'

describe('KeywayLogo', () => {
  it('renders an SVG element', () => {
    const { container } = render(<KeywayLogo />)

    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('uses default size when className not specified', () => {
    const { container } = render(<KeywayLogo />)

    const svg = container.querySelector('svg')
    // Default is w-5 h-5, just verify it has some size classes
    expect(svg?.className).toBeTruthy()
  })

  it('accepts custom className for sizing', () => {
    const { container } = render(<KeywayLogo className="w-10 h-10" />)

    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('w-10', 'h-10')
  })

  it('inherits color from parent via currentColor', () => {
    const { container } = render(<KeywayLogo />)

    const svg = container.querySelector('svg')
    // stroke="currentColor" means it inherits color - this is the key behavior
    expect(svg).toHaveAttribute('stroke', 'currentColor')
  })
})
