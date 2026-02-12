import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from '../app/components/Button'

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, className, ...props }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className} {...props}>
      {children}
    </a>
  ),
}))

describe('Button', () => {
  describe('as button element', () => {
    it('renders a button when no href provided', () => {
      render(<Button>Click me</Button>)

      const button = screen.getByRole('button', { name: 'Click me' })
      expect(button).toBeInTheDocument()
      expect(button.tagName).toBe('BUTTON')
    })

    it('handles click events', () => {
      const handleClick = vi.fn()
      render(<Button onClick={handleClick}>Click me</Button>)

      fireEvent.click(screen.getByRole('button'))
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('can be disabled', () => {
      render(<Button disabled>Click me</Button>)

      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('does not trigger onClick when disabled', () => {
      const handleClick = vi.fn()
      render(<Button disabled onClick={handleClick}>Click me</Button>)

      fireEvent.click(screen.getByRole('button'))
      expect(handleClick).not.toHaveBeenCalled()
    })

    it('accepts button type attribute', () => {
      render(<Button type="submit">Submit</Button>)

      expect(screen.getByRole('button')).toHaveAttribute('type', 'submit')
    })
  })

  describe('as link element', () => {
    it('renders a link when href provided', () => {
      render(<Button href="/test">Go to test</Button>)

      const link = screen.getByRole('link', { name: 'Go to test' })
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('href', '/test')
    })

    it('does not render as button when href provided', () => {
      render(<Button href="/test">Go to test</Button>)

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('variants', () => {
    it('accepts solid variant (default)', () => {
      render(<Button>Solid</Button>)

      // Should render without error and have styling
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
      expect(button.className).toBeTruthy()
    })

    it('accepts outline variant', () => {
      render(<Button variant="outline">Outline</Button>)

      // Should render without error
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })

    it('applies different styles for different variants', () => {
      const { rerender } = render(<Button>Solid</Button>)
      const solidClassName = screen.getByRole('button').className

      rerender(<Button variant="outline">Outline</Button>)
      const outlineClassName = screen.getByRole('button').className

      // Different variants should have different styles
      expect(solidClassName).not.toBe(outlineClassName)
    })
  })

  describe('colors', () => {
    it('accepts different color props', () => {
      const colors = ['gray', 'cyan', 'green', 'white'] as const

      colors.forEach((color) => {
        const { unmount } = render(<Button color={color}>{color}</Button>)
        expect(screen.getByRole('button')).toBeInTheDocument()
        unmount()
      })
    })

    it('applies different styles for different colors', () => {
      const { rerender } = render(<Button color="gray">Gray</Button>)
      const grayClassName = screen.getByRole('button').className

      rerender(<Button color="cyan">Cyan</Button>)
      const cyanClassName = screen.getByRole('button').className

      // Different colors should have different styles
      expect(grayClassName).not.toBe(cyanClassName)
    })
  })

  describe('className prop', () => {
    it('merges custom className with base styles', () => {
      render(<Button className="custom-class">Custom</Button>)

      const button = screen.getByRole('button')
      expect(button.className).toContain('custom-class')
    })

    it('preserves base styles when custom className added', () => {
      const { rerender } = render(<Button>Base</Button>)
      const baseClassName = screen.getByRole('button').className

      rerender(<Button className="extra">Base</Button>)
      const withExtraClassName = screen.getByRole('button').className

      // Should have base styles plus extra class
      expect(withExtraClassName).toContain('extra')
      expect(withExtraClassName.length).toBeGreaterThan(baseClassName.length)
    })
  })
})
