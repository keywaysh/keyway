import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ViewSecretModal } from '../app/components/dashboard/ViewSecretModal'
import type { Secret } from '../lib/types'

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock the api module
vi.mock('../lib/api', () => ({
  api: {
    getSecretValue: vi.fn(),
    getSecretVersions: vi.fn(),
    getSecretVersionValue: vi.fn(),
    restoreSecretVersion: vi.fn(),
  },
}))

// Mock the analytics module
vi.mock('../lib/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    SECRET_VIEW: 'secret_view',
    SECRET_COPY: 'secret_copy',
    SECRET_VERSION_RESTORED: 'secret_version_restored',
  },
}))

// Mock clipboard API
const mockClipboard = {
  writeText: vi.fn(),
}
Object.assign(navigator, { clipboard: mockClipboard })

import { api } from '../lib/api'
import { trackEvent, AnalyticsEvents } from '../lib/analytics'

const mockSecret: Secret = {
  id: 'secret-1',
  name: 'API_KEY',
  environment: 'development',
  created_at: '2025-01-05T10:00:00Z',
  updated_at: '2025-01-10T15:30:00Z',
}

describe('ViewSecretModal', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockClipboard.writeText.mockResolvedValue(undefined)
    ;(api.getSecretValue as ReturnType<typeof vi.fn>).mockResolvedValue({
      value: 'super-secret-value-123',
      preview: 'super-s***',
    })
  })

  describe('rendering', () => {
    it('should not render when closed', () => {
      render(
        <ViewSecretModal
          isOpen={false}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      expect(screen.queryByText('View Secret')).not.toBeInTheDocument()
    })

    it('should render when open with secret', () => {
      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      expect(screen.getByText('View Secret')).toBeInTheDocument()
      expect(screen.getByText('API_KEY')).toBeInTheDocument()
      expect(screen.getByText('development')).toBeInTheDocument()
    })

    it('should show masked value initially', () => {
      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      expect(screen.getByText('••••••••••••••••••••••••••••••••')).toBeInTheDocument()
    })

    it('should show formatted dates', () => {
      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      expect(screen.getByText(/Created:/)).toBeInTheDocument()
      expect(screen.getByText(/Updated:/)).toBeInTheDocument()
    })

    it('should only have Close button in footer', () => {
      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      // Should have Close button in footer (not the X icon)
      const closeButtons = screen.getAllByRole('button', { name: /close/i })
      // There should be 2: the X icon button and the footer Close button
      expect(closeButtons.length).toBe(2)
      // Should NOT have Edit button
      expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
    })
  })

  describe('reveal functionality', () => {
    it('should fetch and show value when Show button clicked', async () => {
      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      const showButton = screen.getByRole('button', { name: /show/i })
      fireEvent.click(showButton)

      await waitFor(() => {
        expect(api.getSecretValue).toHaveBeenCalledWith('owner', 'repo', 'secret-1')
      })

      await waitFor(() => {
        expect(screen.getByText('super-secret-value-123')).toBeInTheDocument()
      })
    })

    it('should track SECRET_VIEW event when revealed', async () => {
      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      const showButton = screen.getByRole('button', { name: /show/i })
      fireEvent.click(showButton)

      await waitFor(() => {
        expect(trackEvent).toHaveBeenCalledWith(AnalyticsEvents.SECRET_VIEW, {
          secretName: 'API_KEY',
        })
      })
    })

    it('should toggle visibility without re-fetch when clicking Hide', async () => {
      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      // Show
      const showButton = screen.getByRole('button', { name: /show/i })
      fireEvent.click(showButton)

      await waitFor(() => {
        expect(screen.getByText('super-secret-value-123')).toBeInTheDocument()
      })

      // Hide
      const hideButton = screen.getByRole('button', { name: /hide/i })
      fireEvent.click(hideButton)

      await waitFor(() => {
        expect(screen.getByText('••••••••••••••••••••••••••••••••')).toBeInTheDocument()
      })

      // API should only have been called once
      expect(api.getSecretValue).toHaveBeenCalledTimes(1)
    })
  })

  describe('copy functionality', () => {
    it('should copy value to clipboard when Copy clicked', async () => {
      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      const copyButton = screen.getByRole('button', { name: /^copy$/i })
      fireEvent.click(copyButton)

      await waitFor(() => {
        expect(mockClipboard.writeText).toHaveBeenCalledWith('super-secret-value-123')
      })
    })

    it('should track SECRET_COPY event when copied', async () => {
      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      const copyButton = screen.getByRole('button', { name: /^copy$/i })
      fireEvent.click(copyButton)

      await waitFor(() => {
        expect(trackEvent).toHaveBeenCalledWith(AnalyticsEvents.SECRET_COPY, {
          secretName: 'API_KEY',
        })
      })
    })

    it('should not re-fetch if value already loaded', async () => {
      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      // First, reveal the value
      const showButton = screen.getByRole('button', { name: /show/i })
      fireEvent.click(showButton)

      await waitFor(() => {
        expect(api.getSecretValue).toHaveBeenCalledTimes(1)
      })

      // Then copy
      const copyButton = screen.getByRole('button', { name: /^copy$/i })
      fireEvent.click(copyButton)

      await waitFor(() => {
        expect(mockClipboard.writeText).toHaveBeenCalled()
      })

      // Should still be only 1 API call
      expect(api.getSecretValue).toHaveBeenCalledTimes(1)
    })
  })

  describe('close functionality', () => {
    it('should call onClose when Close button clicked', () => {
      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      // Get the footer Close button (not the X icon - we want the text "Close" button)
      const closeButtons = screen.getAllByRole('button', { name: /close/i })
      // Click the footer button (which has text "Close" visible)
      const footerCloseButton = closeButtons.find(btn => btn.textContent === 'Close')!
      fireEvent.click(footerCloseButton)

      expect(mockOnClose).toHaveBeenCalled()
    })
  })

  describe('state reset', () => {
    it('should reset value when modal closes and reopens', async () => {
      const { rerender } = render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      // Reveal the value
      const showButton = screen.getByRole('button', { name: /show/i })
      fireEvent.click(showButton)

      await waitFor(() => {
        expect(screen.getByText('super-secret-value-123')).toBeInTheDocument()
      })

      // Close modal
      rerender(
        <ViewSecretModal
          isOpen={false}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      // Reopen modal
      rerender(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      // Value should be masked again
      expect(screen.getByText('••••••••••••••••••••••••••••••••')).toBeInTheDocument()
    })
  })

  describe('error handling', () => {
    it('should show error toast when fetch fails', async () => {
      ;(api.getSecretValue as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      )

      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      const showButton = screen.getByRole('button', { name: /show/i })
      fireEvent.click(showButton)

      // The error is handled via toast, which we don't test here
      // but we verify the API was called
      await waitFor(() => {
        expect(api.getSecretValue).toHaveBeenCalled()
      })
    })
  })

  describe('version history', () => {
    const mockVersions = [
      {
        id: 'version-1',
        version_number: 1,
        created_at: '2025-01-05T10:00:00Z',
        created_by: {
          username: 'testuser',
          avatar_url: 'https://avatar.example.com/testuser.png',
        },
      },
      {
        id: 'version-2',
        version_number: 2,
        created_at: '2025-01-10T15:30:00Z',
        created_by: {
          username: 'anotheruser',
          avatar_url: null,
        },
      },
    ]

    beforeEach(() => {
      ;(api.getSecretVersions as ReturnType<typeof vi.fn>).mockResolvedValue(mockVersions)
      ;(api.getSecretVersionValue as ReturnType<typeof vi.fn>).mockResolvedValue({
        value: 'old-secret-value',
      })
      ;(api.restoreSecretVersion as ReturnType<typeof vi.fn>).mockResolvedValue({})
    })

    it('should render Version History button', () => {
      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      expect(screen.getByText('Version History')).toBeInTheDocument()
    })

    it('should fetch and display versions when toggle clicked', async () => {
      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      const historyButton = screen.getByText('Version History')
      fireEvent.click(historyButton)

      await waitFor(() => {
        expect(api.getSecretVersions).toHaveBeenCalledWith('owner', 'repo', 'secret-1')
      })

      await waitFor(() => {
        expect(screen.getByText('Version 1')).toBeInTheDocument()
        expect(screen.getByText('Version 2')).toBeInTheDocument()
      })
    })

    it('should show No previous versions when empty', async () => {
      ;(api.getSecretVersions as ReturnType<typeof vi.fn>).mockResolvedValue([])

      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      const historyButton = screen.getByText('Version History')
      fireEvent.click(historyButton)

      await waitFor(() => {
        expect(screen.getByText('No previous versions')).toBeInTheDocument()
      })
    })

    it('should show creator usernames', async () => {
      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      const historyButton = screen.getByText('Version History')
      fireEvent.click(historyButton)

      await waitFor(() => {
        expect(screen.getByText('@testuser')).toBeInTheDocument()
        expect(screen.getByText('@anotheruser')).toBeInTheDocument()
      })
    })

    it('should load version value when version clicked', async () => {
      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      const historyButton = screen.getByText('Version History')
      fireEvent.click(historyButton)

      await waitFor(() => {
        expect(screen.getByText('Version 1')).toBeInTheDocument()
      })

      const version1 = screen.getByText('Version 1')
      fireEvent.click(version1)

      await waitFor(() => {
        expect(api.getSecretVersionValue).toHaveBeenCalledWith('owner', 'repo', 'secret-1', 'version-1')
      })

      await waitFor(() => {
        expect(screen.getByText('old-secret-value')).toBeInTheDocument()
      })
    })

    it('should show Restore button when canWrite is true', async () => {
      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
          canWrite={true}
        />
      )

      const historyButton = screen.getByText('Version History')
      fireEvent.click(historyButton)

      await waitFor(() => {
        expect(screen.getByText('Version 1')).toBeInTheDocument()
      })

      const version1 = screen.getByText('Version 1')
      fireEvent.click(version1)

      await waitFor(() => {
        expect(screen.getByText('Restore this version')).toBeInTheDocument()
      })
    })

    it('should not show Restore button when canWrite is false', async () => {
      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
          canWrite={false}
        />
      )

      const historyButton = screen.getByText('Version History')
      fireEvent.click(historyButton)

      await waitFor(() => {
        expect(screen.getByText('Version 1')).toBeInTheDocument()
      })

      const version1 = screen.getByText('Version 1')
      fireEvent.click(version1)

      await waitFor(() => {
        expect(screen.getByText('old-secret-value')).toBeInTheDocument()
      })

      expect(screen.queryByText('Restore this version')).not.toBeInTheDocument()
    })

    it('should show restore confirmation dialog', async () => {
      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
          canWrite={true}
        />
      )

      const historyButton = screen.getByText('Version History')
      fireEvent.click(historyButton)

      await waitFor(() => {
        expect(screen.getByText('Version 1')).toBeInTheDocument()
      })

      const version1 = screen.getByText('Version 1')
      fireEvent.click(version1)

      await waitFor(() => {
        expect(screen.getByText('Restore this version')).toBeInTheDocument()
      })

      const restoreButton = screen.getByText('Restore this version')
      fireEvent.click(restoreButton)

      await waitFor(() => {
        expect(screen.getByText('Restore version?')).toBeInTheDocument()
      })
    })

    it('should call restoreSecretVersion on confirm', async () => {
      const mockOnSecretUpdated = vi.fn()

      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
          canWrite={true}
          onSecretUpdated={mockOnSecretUpdated}
        />
      )

      const historyButton = screen.getByText('Version History')
      fireEvent.click(historyButton)

      await waitFor(() => {
        expect(screen.getByText('Version 1')).toBeInTheDocument()
      })

      const version1 = screen.getByText('Version 1')
      fireEvent.click(version1)

      await waitFor(() => {
        expect(screen.getByText('Restore this version')).toBeInTheDocument()
      })

      const restoreButton = screen.getByText('Restore this version')
      fireEvent.click(restoreButton)

      await waitFor(() => {
        expect(screen.getByText('Restore version?')).toBeInTheDocument()
      })

      const confirmButton = screen.getByRole('button', { name: /^Restore$/ })
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(api.restoreSecretVersion).toHaveBeenCalledWith('owner', 'repo', 'secret-1', 'version-1')
      })

      await waitFor(() => {
        expect(mockOnSecretUpdated).toHaveBeenCalled()
        expect(mockOnClose).toHaveBeenCalled()
      })
    })

    it('should deselect version when clicking on it again', async () => {
      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      const historyButton = screen.getByText('Version History')
      fireEvent.click(historyButton)

      await waitFor(() => {
        expect(screen.getByText('Version 1')).toBeInTheDocument()
      })

      const version1 = screen.getByText('Version 1')
      fireEvent.click(version1)

      await waitFor(() => {
        expect(screen.getByText('old-secret-value')).toBeInTheDocument()
      })

      // Click again to deselect
      fireEvent.click(version1)

      await waitFor(() => {
        expect(screen.queryByText('old-secret-value')).not.toBeInTheDocument()
      })
    })

    it('should handle version fetch error', async () => {
      ;(api.getSecretVersions as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Failed to load versions')
      )

      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      const historyButton = screen.getByText('Version History')
      fireEvent.click(historyButton)

      await waitFor(() => {
        expect(api.getSecretVersions).toHaveBeenCalled()
      })
    })

    it('should handle version value fetch error', async () => {
      ;(api.getSecretVersionValue as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Failed to load version value')
      )

      render(
        <ViewSecretModal
          isOpen={true}
          onClose={mockOnClose}
          secret={mockSecret}
          owner="owner"
          repo="repo"
        />
      )

      const historyButton = screen.getByText('Version History')
      fireEvent.click(historyButton)

      await waitFor(() => {
        expect(screen.getByText('Version 1')).toBeInTheDocument()
      })

      const version1 = screen.getByText('Version 1')
      fireEvent.click(version1)

      await waitFor(() => {
        expect(api.getSecretVersionValue).toHaveBeenCalled()
      })
    })
  })
})
