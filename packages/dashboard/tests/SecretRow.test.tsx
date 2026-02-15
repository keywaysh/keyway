import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SecretRow, SecretRowSkeleton } from '../app/components/dashboard/SecretRow'
import type { Secret } from '../lib/types'

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ src, alt, ...props }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...props} />
  ),
}))

// Mock environment colors
vi.mock('@/lib/environment-colors', () => ({
  getEnvironmentColor: (env: string) => ({
    bg: `bg-${env}`,
    border: `border-${env}`,
    text: `text-${env}`,
  }),
}))

const mockSecret: Secret = {
  id: 'secret-1',
  name: 'API_KEY',
  environment: 'production',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-02-20T15:30:00Z',
  last_modified_by: {
    username: 'johndoe',
    avatar_url: 'https://example.com/avatar.jpg',
  },
}

const mockSecretWithoutModifier: Secret = {
  ...mockSecret,
  id: 'secret-2',
  last_modified_by: null,
}

const mockSecretWithUsernameOnly: Secret = {
  ...mockSecret,
  id: 'secret-3',
  last_modified_by: {
    username: 'jane',
    avatar_url: null,
  },
}

describe('SecretRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render secret name', () => {
      render(<SecretRow secret={mockSecret} />)

      expect(screen.getByText('API_KEY')).toBeInTheDocument()
    })

    it('should render environment badge', () => {
      render(<SecretRow secret={mockSecret} />)

      expect(screen.getByText('production')).toBeInTheDocument()
    })

    it('should render formatted dates', () => {
      render(<SecretRow secret={mockSecret} />)

      expect(screen.getByText(/Created Jan 15, 2024/)).toBeInTheDocument()
      expect(screen.getByText(/Updated Feb 20, 2024/)).toBeInTheDocument()
    })

    it('should render last modified by user when available', () => {
      render(<SecretRow secret={mockSecret} />)

      expect(screen.getByText('@johndoe')).toBeInTheDocument()
      expect(screen.getByAltText('johndoe')).toHaveAttribute(
        'src',
        'https://example.com/avatar.jpg'
      )
    })

    it('should not render last modified by when null', () => {
      render(<SecretRow secret={mockSecretWithoutModifier} />)

      expect(screen.queryByText('@johndoe')).not.toBeInTheDocument()
    })

    it('should render username without avatar when avatar_url is null', () => {
      render(<SecretRow secret={mockSecretWithUsernameOnly} />)

      expect(screen.getByText('@jane')).toBeInTheDocument()
      // Avatar should not be rendered
      expect(screen.queryByAltText('jane')).not.toBeInTheDocument()
    })
  })

  describe('action buttons', () => {
    it('should render view button when onView provided', () => {
      const onView = vi.fn()
      render(<SecretRow secret={mockSecret} onView={onView} />)

      expect(screen.getByRole('button', { name: /view secret/i })).toBeInTheDocument()
    })

    it('should not render view button when onView not provided', () => {
      render(<SecretRow secret={mockSecret} />)

      expect(screen.queryByRole('button', { name: /view secret/i })).not.toBeInTheDocument()
    })

    it('should render edit button when onEdit provided', () => {
      const onEdit = vi.fn()
      render(<SecretRow secret={mockSecret} onEdit={onEdit} />)

      expect(screen.getByRole('button', { name: /edit secret/i })).toBeInTheDocument()
    })

    it('should not render edit button when onEdit not provided', () => {
      render(<SecretRow secret={mockSecret} />)

      expect(screen.queryByRole('button', { name: /edit secret/i })).not.toBeInTheDocument()
    })

    it('should render delete button when onDelete provided', () => {
      const onDelete = vi.fn()
      render(<SecretRow secret={mockSecret} onDelete={onDelete} />)

      expect(screen.getByRole('button', { name: /delete secret/i })).toBeInTheDocument()
    })

    it('should not render delete button when onDelete not provided', () => {
      render(<SecretRow secret={mockSecret} />)

      expect(screen.queryByRole('button', { name: /delete secret/i })).not.toBeInTheDocument()
    })
  })

  describe('view action', () => {
    it('should call onView with secret when view button clicked', () => {
      const onView = vi.fn()
      render(<SecretRow secret={mockSecret} onView={onView} />)

      fireEvent.click(screen.getByRole('button', { name: /view secret/i }))

      expect(onView).toHaveBeenCalledWith(mockSecret)
    })
  })

  describe('edit action', () => {
    it('should call onEdit with secret when edit button clicked', () => {
      const onEdit = vi.fn()
      render(<SecretRow secret={mockSecret} onEdit={onEdit} />)

      fireEvent.click(screen.getByRole('button', { name: /edit secret/i }))

      expect(onEdit).toHaveBeenCalledWith(mockSecret)
    })
  })

  describe('delete action', () => {
    it('should open confirmation dialog when delete button clicked', () => {
      const onDelete = vi.fn()
      render(<SecretRow secret={mockSecret} onDelete={onDelete} />)

      fireEvent.click(screen.getByRole('button', { name: /delete secret/i }))

      expect(screen.getByText('Delete secret?')).toBeInTheDocument()
      expect(screen.getAllByText(/API_KEY/).length).toBeGreaterThan(1) // In row + dialog
      expect(screen.getByText(/will be moved to trash/)).toBeInTheDocument()
    })

    it('should show restore message in confirmation dialog', () => {
      const onDelete = vi.fn()
      render(<SecretRow secret={mockSecret} onDelete={onDelete} />)

      fireEvent.click(screen.getByRole('button', { name: /delete secret/i }))

      expect(screen.getByText(/You can restore it within 30 days/)).toBeInTheDocument()
    })

    it('should close dialog when Cancel clicked', () => {
      const onDelete = vi.fn()
      render(<SecretRow secret={mockSecret} onDelete={onDelete} />)

      fireEvent.click(screen.getByRole('button', { name: /delete secret/i }))
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

      expect(screen.queryByText('Delete secret?')).not.toBeInTheDocument()
    })

    it('should call onDelete when Delete confirmed', async () => {
      const onDelete = vi.fn().mockResolvedValue(undefined)
      render(<SecretRow secret={mockSecret} onDelete={onDelete} />)

      fireEvent.click(screen.getByRole('button', { name: /delete secret/i }))
      fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))

      await waitFor(() => {
        expect(onDelete).toHaveBeenCalledWith(mockSecret)
      })
    })

    it('should close dialog after successful deletion', async () => {
      const onDelete = vi.fn().mockResolvedValue(undefined)
      render(<SecretRow secret={mockSecret} onDelete={onDelete} />)

      fireEvent.click(screen.getByRole('button', { name: /delete secret/i }))

      // Find and click the Delete button in the dialog
      const deleteButtons = screen.getAllByRole('button')
      const confirmButton = deleteButtons.find(btn => btn.textContent === 'Delete')
      expect(confirmButton).toBeDefined()
      fireEvent.click(confirmButton!)

      await waitFor(() => {
        expect(onDelete).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(screen.queryByText('Delete secret?')).not.toBeInTheDocument()
      })
    })
  })
})

describe('SecretRowSkeleton', () => {
  it('should render skeleton loading state', () => {
    const { container } = render(<SecretRowSkeleton />)

    // Should render a loading skeleton structure
    expect(container.firstChild).toBeInTheDocument()
  })

  it('should have similar structure to SecretRow', () => {
    const { container } = render(<SecretRowSkeleton />)

    // Should have the same flex layout as SecretRow
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('flex')
    expect(wrapper.className).toContain('items-center')
  })
})
