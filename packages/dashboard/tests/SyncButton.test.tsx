import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SyncButton } from '../app/components/dashboard/SyncButton'
import type { VaultSync } from '../lib/types'

// Mock the api module
vi.mock('../lib/api', () => ({
  api: {
    getSyncPreview: vi.fn(),
    executeSync: vi.fn(),
  },
}))

import { api } from '../lib/api'

const mockSync: VaultSync = {
  id: 'sync-1',
  provider: 'vercel',
  project_id: 'prj-123',
  project_name: 'my-project',
  connection_id: 'conn-456',
  keyway_environment: 'production',
  provider_environment: 'production',
  last_synced_at: '2025-01-10T10:00:00Z',
}

describe('SyncButton', () => {
  const mockOnSyncComplete = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render sync button', () => {
      render(
        <SyncButton
          sync={mockSync}
          owner="owner"
          repo="repo"
          providerLabel="Vercel"
          onSyncComplete={mockOnSyncComplete}
        />
      )

      expect(screen.getByRole('button', { name: /sync/i })).toBeInTheDocument()
    })
  })

  describe('preview loading', () => {
    it('should show loading state when modal opens', async () => {
      ;(api.getSyncPreview as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(() => {}) // Never resolves to keep loading state
      )

      render(
        <SyncButton
          sync={mockSync}
          owner="owner"
          repo="repo"
          providerLabel="Vercel"
          onSyncComplete={mockOnSyncComplete}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /sync/i }))

      await waitFor(() => {
        expect(screen.getByText('Loading preview...')).toBeInTheDocument()
      })
    })

    it('should call getSyncPreview with correct parameters', async () => {
      ;(api.getSyncPreview as ReturnType<typeof vi.fn>).mockResolvedValue({
        toCreate: [],
        toUpdate: [],
        toDelete: [],
        toSkip: [],
      })

      render(
        <SyncButton
          sync={mockSync}
          owner="owner"
          repo="repo"
          providerLabel="Vercel"
          onSyncComplete={mockOnSyncComplete}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /sync/i }))

      await waitFor(() => {
        expect(api.getSyncPreview).toHaveBeenCalledWith(
          'owner',
          'repo',
          'conn-456',
          'prj-123',
          'production',
          'production'
        )
      })
    })
  })

  describe('preview display', () => {
    it('should show "Already in sync" when no changes', async () => {
      ;(api.getSyncPreview as ReturnType<typeof vi.fn>).mockResolvedValue({
        toCreate: [],
        toUpdate: [],
        toDelete: [],
        toSkip: ['EXISTING_VAR'],
      })

      render(
        <SyncButton
          sync={mockSync}
          owner="owner"
          repo="repo"
          providerLabel="Vercel"
          onSyncComplete={mockOnSyncComplete}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /sync/i }))

      await waitFor(() => {
        expect(screen.getByText('Already in sync')).toBeInTheDocument()
      })

      // Should have Close button in footer (there are 2 close buttons - X icon and footer button)
      const closeButtons = screen.getAllByRole('button', { name: /close/i })
      expect(closeButtons.length).toBeGreaterThanOrEqual(1)
      // Should NOT have Sync now button
      expect(screen.queryByRole('button', { name: /sync now/i })).not.toBeInTheDocument()
    })

    it('should show secrets to create', async () => {
      ;(api.getSyncPreview as ReturnType<typeof vi.fn>).mockResolvedValue({
        toCreate: ['NEW_VAR', 'ANOTHER_VAR'],
        toUpdate: [],
        toDelete: [],
        toSkip: [],
      })

      render(
        <SyncButton
          sync={mockSync}
          owner="owner"
          repo="repo"
          providerLabel="Vercel"
          onSyncComplete={mockOnSyncComplete}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /sync/i }))

      await waitFor(() => {
        expect(screen.getByText('2 secrets to create')).toBeInTheDocument()
        expect(screen.getByText('NEW_VAR')).toBeInTheDocument()
        expect(screen.getByText('ANOTHER_VAR')).toBeInTheDocument()
      })
    })

    it('should show secrets to update', async () => {
      ;(api.getSyncPreview as ReturnType<typeof vi.fn>).mockResolvedValue({
        toCreate: [],
        toUpdate: ['UPDATED_VAR'],
        toDelete: [],
        toSkip: [],
      })

      render(
        <SyncButton
          sync={mockSync}
          owner="owner"
          repo="repo"
          providerLabel="Vercel"
          onSyncComplete={mockOnSyncComplete}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /sync/i }))

      await waitFor(() => {
        expect(screen.getByText('1 secret to update')).toBeInTheDocument()
        expect(screen.getByText('UPDATED_VAR')).toBeInTheDocument()
      })
    })

    it('should show count of skipped secrets', async () => {
      ;(api.getSyncPreview as ReturnType<typeof vi.fn>).mockResolvedValue({
        toCreate: ['NEW_VAR'],
        toUpdate: [],
        toDelete: [],
        toSkip: ['SKIP_1', 'SKIP_2', 'SKIP_3'],
      })

      render(
        <SyncButton
          sync={mockSync}
          owner="owner"
          repo="repo"
          providerLabel="Vercel"
          onSyncComplete={mockOnSyncComplete}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /sync/i }))

      await waitFor(() => {
        expect(screen.getByText('3 secrets already up to date')).toBeInTheDocument()
      })
    })

    it('should show environment mapping in description', async () => {
      ;(api.getSyncPreview as ReturnType<typeof vi.fn>).mockResolvedValue({
        toCreate: ['NEW_VAR'],
        toUpdate: [],
        toDelete: [],
        toSkip: [],
      })

      render(
        <SyncButton
          sync={mockSync}
          owner="owner"
          repo="repo"
          providerLabel="Vercel"
          onSyncComplete={mockOnSyncComplete}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /sync/i }))

      await waitFor(() => {
        // Check for the description text that mentions pushing secrets
        expect(screen.getByText(/Push secrets from/)).toBeInTheDocument()
      })
    })
  })

  describe('sync execution', () => {
    it('should execute sync when Sync now clicked', async () => {
      ;(api.getSyncPreview as ReturnType<typeof vi.fn>).mockResolvedValue({
        toCreate: ['NEW_VAR'],
        toUpdate: [],
        toDelete: [],
        toSkip: [],
      })
      ;(api.executeSync as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'success',
        created: 1,
        updated: 0,
        deleted: 0,
        skipped: 0,
      })

      render(
        <SyncButton
          sync={mockSync}
          owner="owner"
          repo="repo"
          providerLabel="Vercel"
          onSyncComplete={mockOnSyncComplete}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /sync/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sync now/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /sync now/i }))

      await waitFor(() => {
        expect(api.executeSync).toHaveBeenCalledWith(
          'owner',
          'repo',
          'conn-456',
          'prj-123',
          'production',
          'production'
        )
      })
    })

    it('should show syncing state during execution', async () => {
      ;(api.getSyncPreview as ReturnType<typeof vi.fn>).mockResolvedValue({
        toCreate: ['NEW_VAR'],
        toUpdate: [],
        toDelete: [],
        toSkip: [],
      })
      ;(api.executeSync as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      )

      render(
        <SyncButton
          sync={mockSync}
          owner="owner"
          repo="repo"
          providerLabel="Vercel"
          onSyncComplete={mockOnSyncComplete}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /sync/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sync now/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /sync now/i }))

      await waitFor(() => {
        expect(screen.getByText('Syncing secrets...')).toBeInTheDocument()
      })
    })

    it('should show success state after sync completes', async () => {
      ;(api.getSyncPreview as ReturnType<typeof vi.fn>).mockResolvedValue({
        toCreate: ['NEW_VAR'],
        toUpdate: ['UPDATED_VAR'],
        toDelete: [],
        toSkip: [],
      })
      ;(api.executeSync as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'success',
        created: 1,
        updated: 1,
        deleted: 0,
        skipped: 0,
      })

      render(
        <SyncButton
          sync={mockSync}
          owner="owner"
          repo="repo"
          providerLabel="Vercel"
          onSyncComplete={mockOnSyncComplete}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /sync/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sync now/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /sync now/i }))

      await waitFor(() => {
        expect(screen.getByText('Sync complete!')).toBeInTheDocument()
        expect(screen.getByText('1 created, 1 updated')).toBeInTheDocument()
      })
    })
  })

  describe('error handling', () => {
    it('should show error state when preview fails', async () => {
      ;(api.getSyncPreview as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Connection failed')
      )

      render(
        <SyncButton
          sync={mockSync}
          owner="owner"
          repo="repo"
          providerLabel="Vercel"
          onSyncComplete={mockOnSyncComplete}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /sync/i }))

      await waitFor(() => {
        expect(screen.getByText('Error')).toBeInTheDocument()
        expect(screen.getByText('Connection failed')).toBeInTheDocument()
      })

      // Should have Retry button
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    })

    it('should show error state when sync fails', async () => {
      ;(api.getSyncPreview as ReturnType<typeof vi.fn>).mockResolvedValue({
        toCreate: ['NEW_VAR'],
        toUpdate: [],
        toDelete: [],
        toSkip: [],
      })
      ;(api.executeSync as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'error',
        created: 0,
        updated: 0,
        deleted: 0,
        skipped: 0,
        error: 'Provider API error',
      })

      render(
        <SyncButton
          sync={mockSync}
          owner="owner"
          repo="repo"
          providerLabel="Vercel"
          onSyncComplete={mockOnSyncComplete}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /sync/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sync now/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /sync now/i }))

      await waitFor(() => {
        expect(screen.getByText('Error')).toBeInTheDocument()
        expect(screen.getByText('Provider API error')).toBeInTheDocument()
      })
    })

    it('should retry preview when Retry clicked', async () => {
      ;(api.getSyncPreview as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('First attempt failed'))
        .mockResolvedValueOnce({
          toCreate: ['NEW_VAR'],
          toUpdate: [],
          toDelete: [],
          toSkip: [],
        })

      render(
        <SyncButton
          sync={mockSync}
          owner="owner"
          repo="repo"
          providerLabel="Vercel"
          onSyncComplete={mockOnSyncComplete}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /sync/i }))

      await waitFor(() => {
        expect(screen.getByText('Error')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /retry/i }))

      await waitFor(() => {
        expect(screen.getByText('1 secret to create')).toBeInTheDocument()
      })

      expect(api.getSyncPreview).toHaveBeenCalledTimes(2)
    })
  })

  describe('modal behavior', () => {
    it('should close modal when Cancel clicked', async () => {
      ;(api.getSyncPreview as ReturnType<typeof vi.fn>).mockResolvedValue({
        toCreate: ['NEW_VAR'],
        toUpdate: [],
        toDelete: [],
        toSkip: [],
      })

      render(
        <SyncButton
          sync={mockSync}
          owner="owner"
          repo="repo"
          providerLabel="Vercel"
          onSyncComplete={mockOnSyncComplete}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /sync/i }))

      await waitFor(() => {
        expect(screen.getByText('Sync to Vercel')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

      await waitFor(() => {
        expect(screen.queryByText('Sync to Vercel')).not.toBeInTheDocument()
      })
    })

    it('should show correct title with provider label', async () => {
      ;(api.getSyncPreview as ReturnType<typeof vi.fn>).mockResolvedValue({
        toCreate: [],
        toUpdate: [],
        toDelete: [],
        toSkip: [],
      })

      render(
        <SyncButton
          sync={mockSync}
          owner="owner"
          repo="repo"
          providerLabel="Railway"
          onSyncComplete={mockOnSyncComplete}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /sync/i }))

      await waitFor(() => {
        expect(screen.getByText('Sync to Railway')).toBeInTheDocument()
      })
    })
  })
})
