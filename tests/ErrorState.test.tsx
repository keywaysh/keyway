import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorState, EmptyState } from '../app/components/dashboard/ErrorState'
import { FileText } from 'lucide-react'

describe('ErrorState', () => {
  it('renders with default title', () => {
    render(<ErrorState message="An error occurred" />)

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('renders with custom title', () => {
    render(<ErrorState title="Custom Error" message="An error occurred" />)

    expect(screen.getByText('Custom Error')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })

  it('renders the error message', () => {
    render(<ErrorState message="Connection failed" />)

    expect(screen.getByText('Connection failed')).toBeInTheDocument()
  })

  it('renders error icon', () => {
    const { container } = render(<ErrorState message="Error" />)

    // AlertTriangle icon should be present
    const icon = container.querySelector('.text-destructive')
    expect(icon).toBeInTheDocument()
  })

  it('does not render retry button when onRetry not provided', () => {
    render(<ErrorState message="Error" />)

    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
  })

  it('renders retry button when onRetry provided', () => {
    const handleRetry = vi.fn()
    render(<ErrorState message="Error" onRetry={handleRetry} />)

    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('calls onRetry when retry button clicked', () => {
    const handleRetry = vi.fn()
    render(<ErrorState message="Error" onRetry={handleRetry} />)

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(handleRetry).toHaveBeenCalledTimes(1)
  })
})

describe('EmptyState', () => {
  it('renders title and message', () => {
    render(<EmptyState title="No items" message="Create your first item" />)

    expect(screen.getByText('No items')).toBeInTheDocument()
    expect(screen.getByText('Create your first item')).toBeInTheDocument()
  })

  it('renders default Inbox icon when no icon specified', () => {
    const { container } = render(
      <EmptyState title="Empty" message="Nothing here" />
    )

    // Default icon should be present in the muted circle
    const iconContainer = container.querySelector('.bg-muted')
    expect(iconContainer).toBeInTheDocument()
  })

  it('renders custom icon when provided', () => {
    const { container } = render(
      <EmptyState
        title="No files"
        message="Upload a file"
        icon={FileText}
      />
    )

    const iconContainer = container.querySelector('.bg-muted')
    expect(iconContainer).toBeInTheDocument()
  })

  it('does not render action when not provided', () => {
    render(<EmptyState title="Empty" message="Nothing here" />)

    // Only title and message should be in the document
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders action when provided', () => {
    render(
      <EmptyState
        title="No items"
        message="Create your first item"
        action={<button>Create Item</button>}
      />
    )

    expect(screen.getByRole('button', { name: 'Create Item' })).toBeInTheDocument()
  })

  it('has correct layout structure', () => {
    const { container } = render(
      <EmptyState title="Empty" message="Nothing" />
    )

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveClass('flex', 'flex-col', 'items-center', 'justify-center', 'gap-4', 'py-12')
  })
})
