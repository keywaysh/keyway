import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TrashSection } from '../app/components/dashboard/TrashSection'
import type { TrashedSecret } from '../lib/types'

// Mock analytics
const mockTrackEvent = vi.fn()
vi.mock('@/lib/analytics', () => ({
  trackEvent: (event: string, data?: unknown) => mockTrackEvent(event, data),
  AnalyticsEvents: {
    TRASH_VIEW: 'TRASH_VIEW',
    TRASH_RESTORE: 'TRASH_RESTORE',
    TRASH_PERMANENT_DELETE: 'TRASH_PERMANENT_DELETE',
    TRASH_EMPTY: 'TRASH_EMPTY',
  },
}))

const mockTrashedSecrets: TrashedSecret[] = [
  {
    id: 'trash-1',
    name: 'OLD_API_KEY',
    environment: 'production',
    deleted_at: '2024-01-15T10:00:00Z',
    expires_at: '2024-02-14T10:00:00Z',
    days_remaining: 15,
  },
  {
    id: 'trash-2',
    name: 'DEPRECATED_TOKEN',
    environment: 'staging',
    deleted_at: '2024-01-10T10:00:00Z',
    expires_at: '2024-02-09T10:00:00Z',
    days_remaining: 5,
  },
]

const singleTrashedSecret: TrashedSecret[] = [mockTrashedSecrets[0]]

const expiringSecret: TrashedSecret[] = [
  {
    ...mockTrashedSecrets[0],
    days_remaining: 0,
  },
]

describe('TrashSection', () => {
  const defaultProps = {
    trashedSecrets: mockTrashedSecrets,
    onRestore: vi.fn().mockResolvedValue(undefined),
    onPermanentDelete: vi.fn().mockResolvedValue(undefined),
    onEmptyTrash: vi.fn().mockResolvedValue(undefined),
    canWrite: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockTrackEvent.mockClear()
  })

  describe('rendering', () => {
    it('should not render when no trashed secrets', () => {
      const { container } = render(
        <TrashSection {...defaultProps} trashedSecrets={[]} />
      )

      expect(container.firstChild).toBeNull()
    })

    it('should render collapsed by default', () => {
      render(<TrashSection {...defaultProps} />)

      expect(screen.getByText(/Recently deleted \(2\)/)).toBeInTheDocument()
      expect(screen.queryByText('OLD_API_KEY')).not.toBeInTheDocument()
    })

    it('should show count of trashed secrets', () => {
      render(<TrashSection {...defaultProps} />)

      expect(screen.getByText(/Recently deleted \(2\)/)).toBeInTheDocument()
    })
  })

  describe('expand/collapse', () => {
    it('should expand when header clicked', () => {
      render(<TrashSection {...defaultProps} />)

      fireEvent.click(screen.getByText(/Recently deleted/))

      expect(screen.getByText('OLD_API_KEY')).toBeInTheDocument()
      expect(screen.getByText('DEPRECATED_TOKEN')).toBeInTheDocument()
    })

    it('should collapse when header clicked again', () => {
      render(<TrashSection {...defaultProps} />)

      fireEvent.click(screen.getByText(/Recently deleted/))
      fireEvent.click(screen.getByText(/Recently deleted/))

      expect(screen.queryByText('OLD_API_KEY')).not.toBeInTheDocument()
    })

    it('should show secret names with strikethrough', () => {
      render(<TrashSection {...defaultProps} />)
      fireEvent.click(screen.getByText(/Recently deleted/))

      const secretName = screen.getByText('OLD_API_KEY')
      expect(secretName).toHaveClass('line-through')
    })

    it('should show environment for each secret', () => {
      render(<TrashSection {...defaultProps} />)
      fireEvent.click(screen.getByText(/Recently deleted/))

      expect(screen.getByText('production')).toBeInTheDocument()
      expect(screen.getByText('staging')).toBeInTheDocument()
    })

    it('should show days remaining', () => {
      render(<TrashSection {...defaultProps} />)
      fireEvent.click(screen.getByText(/Recently deleted/))

      expect(screen.getByText('15d left')).toBeInTheDocument()
      expect(screen.getByText('5d left')).toBeInTheDocument()
    })

    it('should show "Expires soon" when days_remaining is 0', () => {
      render(<TrashSection {...defaultProps} trashedSecrets={expiringSecret} />)
      fireEvent.click(screen.getByText(/Recently deleted/))

      expect(screen.getByText('Expires soon')).toBeInTheDocument()
    })

    it('should show info about auto-deletion', () => {
      render(<TrashSection {...defaultProps} />)
      fireEvent.click(screen.getByText(/Recently deleted/))

      expect(
        screen.getByText(/Deleted secrets are automatically removed after 30 days/)
      ).toBeInTheDocument()
    })

    it('should track TRASH_VIEW event when expanded', () => {
      render(<TrashSection {...defaultProps} />)
      fireEvent.click(screen.getByText(/Recently deleted/))

      expect(mockTrackEvent).toHaveBeenCalledWith('TRASH_VIEW', { count: 2 })
    })
  })

  describe('restore action', () => {
    it('should show restore button when canWrite is true', () => {
      render(<TrashSection {...defaultProps} />)
      fireEvent.click(screen.getByText(/Recently deleted/))

      expect(screen.getAllByText('Restore').length).toBe(2)
    })

    it('should not show restore button when canWrite is false', () => {
      render(<TrashSection {...defaultProps} canWrite={false} />)
      fireEvent.click(screen.getByText(/Recently deleted/))

      expect(screen.queryByText('Restore')).not.toBeInTheDocument()
    })

    it('should call onRestore when Restore clicked', async () => {
      const onRestore = vi.fn().mockResolvedValue(undefined)
      render(<TrashSection {...defaultProps} onRestore={onRestore} />)
      fireEvent.click(screen.getByText(/Recently deleted/))

      const restoreButtons = screen.getAllByText('Restore')
      fireEvent.click(restoreButtons[0])

      await waitFor(() => {
        expect(onRestore).toHaveBeenCalledWith(mockTrashedSecrets[0])
      })
    })

    it('should show loading state during restore', async () => {
      const onRestore = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      )
      render(<TrashSection {...defaultProps} onRestore={onRestore} />)
      fireEvent.click(screen.getByText(/Recently deleted/))

      const restoreButtons = screen.getAllByText('Restore')
      fireEvent.click(restoreButtons[0])

      // Button should be disabled during restore
      expect(restoreButtons[0].closest('button')).toBeDisabled()

      await waitFor(() => {
        expect(onRestore).toHaveBeenCalled()
      })
    })

    it('should track TRASH_RESTORE event when restored', async () => {
      const onRestore = vi.fn().mockResolvedValue(undefined)
      render(<TrashSection {...defaultProps} onRestore={onRestore} />)
      fireEvent.click(screen.getByText(/Recently deleted/))
      mockTrackEvent.mockClear() // Clear the TRASH_VIEW event

      const restoreButtons = screen.getAllByText('Restore')
      fireEvent.click(restoreButtons[0])

      await waitFor(() => {
        expect(mockTrackEvent).toHaveBeenCalledWith('TRASH_RESTORE', {
          secretName: 'OLD_API_KEY',
        })
      })
    })
  })

  describe('permanent delete action', () => {
    it('should show delete button when canWrite is true', () => {
      render(<TrashSection {...defaultProps} />)
      fireEvent.click(screen.getByText(/Recently deleted/))

      // Delete buttons are the small trash icon buttons
      const buttons = screen.getAllByRole('button')
      // Filter to find buttons that look like delete buttons (contain trash icon)
      const deleteButtons = buttons.filter((btn) =>
        btn.className.includes('text-destructive') && btn.textContent === ''
      )
      expect(deleteButtons.length).toBeGreaterThan(0)
    })

    it('should open confirmation dialog when delete button clicked', () => {
      render(<TrashSection {...defaultProps} />)
      fireEvent.click(screen.getByText(/Recently deleted/))

      // Find all buttons and click the first delete icon button (not Restore, not Empty trash)
      const buttons = screen.getAllByRole('button')
      const deleteButton = buttons.find((btn) =>
        btn.className.includes('text-destructive') && !btn.textContent?.includes('Empty')
      )
      expect(deleteButton).toBeDefined()
      fireEvent.click(deleteButton!)

      expect(screen.getByText('Permanently delete secret?')).toBeInTheDocument()
    })

    it('should show warning about permanent deletion', () => {
      render(<TrashSection {...defaultProps} />)
      fireEvent.click(screen.getByText(/Recently deleted/))

      const buttons = screen.getAllByRole('button')
      const deleteButton = buttons.find((btn) =>
        btn.className.includes('text-destructive') && !btn.textContent?.includes('Empty')
      )
      expect(deleteButton).toBeDefined()
      fireEvent.click(deleteButton!)

      expect(screen.getByText(/This action cannot be undone/)).toBeInTheDocument()
    })

    it('should call onPermanentDelete when confirmed', async () => {
      const onPermanentDelete = vi.fn().mockResolvedValue(undefined)
      render(<TrashSection {...defaultProps} onPermanentDelete={onPermanentDelete} />)
      fireEvent.click(screen.getByText(/Recently deleted/))

      const buttons = screen.getAllByRole('button')
      const deleteButton = buttons.find((btn) =>
        btn.className.includes('text-destructive') && !btn.textContent?.includes('Empty')
      )
      expect(deleteButton).toBeDefined()
      fireEvent.click(deleteButton!)

      fireEvent.click(screen.getByText('Delete forever'))

      await waitFor(() => {
        expect(onPermanentDelete).toHaveBeenCalledWith(mockTrashedSecrets[0])
      })
    })

    it('should close dialog when Cancel clicked', () => {
      render(<TrashSection {...defaultProps} />)
      fireEvent.click(screen.getByText(/Recently deleted/))

      const buttons = screen.getAllByRole('button')
      const deleteButton = buttons.find((btn) =>
        btn.className.includes('text-destructive') && !btn.textContent?.includes('Empty')
      )
      expect(deleteButton).toBeDefined()
      fireEvent.click(deleteButton!)

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

      expect(screen.queryByText('Permanently delete secret?')).not.toBeInTheDocument()
    })
  })

  describe('empty trash action', () => {
    it('should show Empty trash button when expanded and more than 1 secret', () => {
      render(<TrashSection {...defaultProps} />)
      fireEvent.click(screen.getByText(/Recently deleted/))

      expect(screen.getByText('Empty trash')).toBeInTheDocument()
    })

    it('should not show Empty trash button when only 1 secret', () => {
      render(<TrashSection {...defaultProps} trashedSecrets={singleTrashedSecret} />)
      fireEvent.click(screen.getByText(/Recently deleted/))

      expect(screen.queryByText('Empty trash')).not.toBeInTheDocument()
    })

    it('should not show Empty trash button when canWrite is false', () => {
      render(<TrashSection {...defaultProps} canWrite={false} />)
      fireEvent.click(screen.getByText(/Recently deleted/))

      expect(screen.queryByText('Empty trash')).not.toBeInTheDocument()
    })

    it('should open confirmation dialog when Empty trash clicked', () => {
      render(<TrashSection {...defaultProps} />)
      fireEvent.click(screen.getByText(/Recently deleted/))
      fireEvent.click(screen.getByText('Empty trash'))

      expect(screen.getByText('Empty trash?')).toBeInTheDocument()
      expect(
        screen.getByText(/This will permanently delete all 2 secrets in the trash/)
      ).toBeInTheDocument()
    })

    it('should call onEmptyTrash when confirmed', async () => {
      const onEmptyTrash = vi.fn().mockResolvedValue(undefined)
      render(<TrashSection {...defaultProps} onEmptyTrash={onEmptyTrash} />)
      fireEvent.click(screen.getByText(/Recently deleted/))
      fireEvent.click(screen.getByText('Empty trash'))

      // Click the confirm button in the dialog
      const dialogButtons = screen.getAllByRole('button', { name: /empty trash/i })
      fireEvent.click(dialogButtons[dialogButtons.length - 1])

      await waitFor(() => {
        expect(onEmptyTrash).toHaveBeenCalled()
      })
    })

    it('should close dialog after successful empty trash', async () => {
      const onEmptyTrash = vi.fn().mockResolvedValue(undefined)
      render(<TrashSection {...defaultProps} onEmptyTrash={onEmptyTrash} />)
      fireEvent.click(screen.getByText(/Recently deleted/))
      fireEvent.click(screen.getByText('Empty trash'))

      const dialogButtons = screen.getAllByRole('button', { name: /empty trash/i })
      fireEvent.click(dialogButtons[dialogButtons.length - 1])

      await waitFor(() => {
        expect(onEmptyTrash).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(screen.queryByText('Empty trash?')).not.toBeInTheDocument()
      })
    })
  })
})
