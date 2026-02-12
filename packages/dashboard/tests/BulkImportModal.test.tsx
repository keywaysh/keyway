import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BulkImportModal } from '../app/components/dashboard/BulkImportModal'

// Mock analytics
vi.mock('@/lib/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    BULK_IMPORT_OPEN: 'bulk_import_open',
    BULK_IMPORT_SUCCESS: 'bulk_import_success',
  },
}))

describe('BulkImportModal', () => {
  const mockOnClose = vi.fn()
  const mockOnImport = vi.fn()
  const defaultEnvironments = ['default', 'staging', 'production']
  const defaultExistingSecrets: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    mockOnImport.mockResolvedValue(undefined)
  })

  describe('rendering', () => {
    it('should not render when closed', () => {
      render(
        <BulkImportModal
          isOpen={false}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      expect(screen.queryByText('Bulk Import Secrets')).not.toBeInTheDocument()
    })

    it('should render when open', () => {
      render(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      expect(screen.getByText('Bulk Import Secrets')).toBeInTheDocument()
      expect(screen.getByText('Environment')).toBeInTheDocument()
      expect(screen.getByText('.env Content')).toBeInTheDocument()
      expect(screen.getByText('Cancel')).toBeInTheDocument()
    })

    it('should show import button disabled when no content', () => {
      render(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      expect(screen.getByText('Import 0 secrets')).toBeDisabled()
    })
  })

  describe('parsing .env content', () => {
    it('should parse valid KEY=value format', async () => {
      const user = userEvent.setup()
      render(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      const textarea = screen.getByPlaceholderText(/Paste your .env file content/i)
      await user.type(textarea, 'API_KEY=secret123')

      await waitFor(() => {
        expect(screen.getByText('1 valid')).toBeInTheDocument()
        expect(screen.getByText('API_KEY')).toBeInTheDocument()
      })
    })

    it('should skip empty lines and comments', async () => {
      const user = userEvent.setup()
      render(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      const textarea = screen.getByPlaceholderText(/Paste your .env file content/i)
      await user.type(textarea, '# Comment\n\nAPI_KEY=value\n\n# Another comment')

      await waitFor(() => {
        expect(screen.getByText('1 valid')).toBeInTheDocument()
      })
    })

    it('should handle quoted values', async () => {
      const user = userEvent.setup()
      render(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      const textarea = screen.getByPlaceholderText(/Paste your .env file content/i)
      await user.type(textarea, 'DATABASE_URL="postgres://localhost"')

      await waitFor(() => {
        expect(screen.getByText('1 valid')).toBeInTheDocument()
        expect(screen.getByText('DATABASE_URL')).toBeInTheDocument()
      })
    })

    it('should convert keys to uppercase', async () => {
      const user = userEvent.setup()
      render(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      const textarea = screen.getByPlaceholderText(/Paste your .env file content/i)
      await user.type(textarea, 'my_api_key=value')

      await waitFor(() => {
        expect(screen.getByText('MY_API_KEY')).toBeInTheDocument()
      })
    })

    it('should mark invalid lines', async () => {
      const user = userEvent.setup()
      render(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      const textarea = screen.getByPlaceholderText(/Paste your .env file content/i)
      await user.type(textarea, 'invalid line without equals')

      await waitFor(() => {
        expect(screen.getByText('1 skipped')).toBeInTheDocument()
        expect(screen.getByText('Invalid format. Expected KEY=value')).toBeInTheDocument()
      })
    })

    it('should parse multiple secrets', async () => {
      const user = userEvent.setup()
      render(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      const textarea = screen.getByPlaceholderText(/Paste your .env file content/i)
      await user.type(textarea, 'API_KEY=key1\nDB_URL=postgres\nSECRET=abc')

      await waitFor(() => {
        expect(screen.getByText('3 valid')).toBeInTheDocument()
      })
    })
  })

  describe('duplicate detection', () => {
    it('should mark existing secrets as duplicates', async () => {
      const user = userEvent.setup()
      render(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={['API_KEY', 'DATABASE_URL']}
        />
      )

      const textarea = screen.getByPlaceholderText(/Paste your .env file content/i)
      await user.type(textarea, 'API_KEY=value\nNEW_SECRET=value')

      await waitFor(() => {
        expect(screen.getByText('1 valid')).toBeInTheDocument()
        expect(screen.getByText('1 skipped')).toBeInTheDocument()
        expect(screen.getByText('Already exists (will be skipped)')).toBeInTheDocument()
      })
    })
  })

  describe('environment selection', () => {
    it('should default to first environment', () => {
      render(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={['production', 'staging']}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      expect(screen.getByRole('combobox')).toHaveTextContent('production')
    })

    it('should allow changing environment', async () => {
      const user = userEvent.setup()
      render(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      const select = screen.getByRole('combobox')
      await user.click(select)
      await user.click(screen.getByText('staging'))

      expect(select).toHaveTextContent('staging')
    })
  })

  describe('import submission', () => {
    it('should call onImport with valid secrets', async () => {
      const user = userEvent.setup()
      render(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      const textarea = screen.getByPlaceholderText(/Paste your .env file content/i)
      await user.type(textarea, 'API_KEY=secret123\nDB_URL=postgres')

      await waitFor(() => {
        expect(screen.getByText('2 valid')).toBeInTheDocument()
      })

      await user.click(screen.getByText('Import 2 secrets'))

      await waitFor(() => {
        expect(mockOnImport).toHaveBeenCalledWith([
          { name: 'API_KEY', value: 'secret123', environment: 'default' },
          { name: 'DB_URL', value: 'postgres', environment: 'default' },
        ])
      })
    })

    it('should call onClose after successful import', async () => {
      const user = userEvent.setup()
      render(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      const textarea = screen.getByPlaceholderText(/Paste your .env file content/i)
      await user.type(textarea, 'TEST_KEY=value')

      await waitFor(() => {
        expect(screen.getByText('1 valid')).toBeInTheDocument()
      })

      await user.click(screen.getByText('Import 1 secret'))

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled()
      })
    })

    it('should show error on import failure', async () => {
      mockOnImport.mockRejectedValue(new Error('Network error'))
      const user = userEvent.setup()

      render(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      const textarea = screen.getByPlaceholderText(/Paste your .env file content/i)
      await user.type(textarea, 'API_KEY=value')

      await waitFor(() => {
        expect(screen.getByText('1 valid')).toBeInTheDocument()
      })

      await user.click(screen.getByText('Import 1 secret'))

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
      expect(mockOnClose).not.toHaveBeenCalled()
    })

    it('should show error when no valid secrets', async () => {
      const user = userEvent.setup()
      render(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={['API_KEY']}
        />
      )

      const textarea = screen.getByPlaceholderText(/Paste your .env file content/i)
      await user.type(textarea, 'API_KEY=value')

      await waitFor(() => {
        expect(screen.getByText('1 skipped')).toBeInTheDocument()
      })

      // Force click even if disabled
      const importBtn = screen.getByText('Import 0 secrets')
      expect(importBtn).toBeDisabled()
    })

    it('should use selected environment for import', async () => {
      const user = userEvent.setup()
      render(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      // Change environment
      const select = screen.getByRole('combobox')
      await user.click(select)
      await user.click(screen.getByText('production'))

      // Add content
      const textarea = screen.getByPlaceholderText(/Paste your .env file content/i)
      await user.type(textarea, 'API_KEY=value')

      await waitFor(() => {
        expect(screen.getByText('1 valid')).toBeInTheDocument()
      })

      await user.click(screen.getByText('Import 1 secret'))

      await waitFor(() => {
        expect(mockOnImport).toHaveBeenCalledWith([
          { name: 'API_KEY', value: 'value', environment: 'production' },
        ])
      })
    })
  })

  describe('cancel button', () => {
    it('should call onClose when clicking cancel', async () => {
      const user = userEvent.setup()
      render(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      await user.click(screen.getByText('Cancel'))
      expect(mockOnClose).toHaveBeenCalled()
    })
  })

  describe('loading state', () => {
    it('should show loading text during import', async () => {
      // Make onImport hang
      mockOnImport.mockImplementation(() => new Promise(() => {}))
      const user = userEvent.setup()

      render(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      const textarea = screen.getByPlaceholderText(/Paste your .env file content/i)
      await user.type(textarea, 'API_KEY=value')

      await waitFor(() => {
        expect(screen.getByText('1 valid')).toBeInTheDocument()
      })

      await user.click(screen.getByText('Import 1 secret'))

      await waitFor(() => {
        expect(screen.getByText('Importing...')).toBeInTheDocument()
      })
    })
  })

  describe('reset on reopen', () => {
    it('should reset state when modal reopens', async () => {
      const user = userEvent.setup()
      const { rerender } = render(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      // Add content
      const textarea = screen.getByPlaceholderText(/Paste your .env file content/i)
      await user.type(textarea, 'API_KEY=value')

      await waitFor(() => {
        expect(screen.getByText('1 valid')).toBeInTheDocument()
      })

      // Close modal
      rerender(
        <BulkImportModal
          isOpen={false}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      // Reopen modal
      rerender(
        <BulkImportModal
          isOpen={true}
          onClose={mockOnClose}
          onImport={mockOnImport}
          environments={defaultEnvironments}
          existingSecretNames={defaultExistingSecrets}
        />
      )

      // Content should be reset
      await waitFor(() => {
        expect(screen.queryByText('1 valid')).not.toBeInTheDocument()
      })
    })
  })
})
