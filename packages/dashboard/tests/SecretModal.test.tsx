import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SecretModal } from '../app/components/dashboard/SecretModal'
import type { Secret } from '../lib/types'

const mockSecret: Secret = {
  id: 'secret-1',
  name: 'API_KEY',
  environment: 'production',
  created_at: '2025-01-05T10:00:00Z',
  updated_at: '2025-01-10T15:30:00Z',
  last_modified_by: null,
}

describe('SecretModal', () => {
  const mockOnClose = vi.fn()
  const mockOnSubmit = vi.fn()
  const defaultEnvironments = ['default', 'staging', 'production']

  beforeEach(() => {
    vi.clearAllMocks()
    mockOnSubmit.mockResolvedValue(undefined)
  })

  describe('rendering', () => {
    it('should not render when closed', () => {
      render(
        <SecretModal
          isOpen={false}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
        />
      )

      expect(screen.queryByText('Create Secret')).not.toBeInTheDocument()
    })

    it('should render create mode when open without secret', () => {
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
        />
      )

      expect(screen.getByText('Create Secret')).toBeInTheDocument()
      expect(screen.getByLabelText('Name')).toBeInTheDocument()
      expect(screen.getByLabelText('Value')).toBeInTheDocument()
      expect(screen.getByText('Environments')).toBeInTheDocument()
      expect(screen.getByText('Create')).toBeInTheDocument()
    })

    it('should render edit mode when open with secret', () => {
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          secret={mockSecret}
          environments={defaultEnvironments}
        />
      )

      expect(screen.getByText('Edit Secret')).toBeInTheDocument()
      expect(screen.getByDisplayValue('API_KEY')).toBeInTheDocument()
      expect(screen.getByText('Update')).toBeInTheDocument()
      expect(screen.getByText('Environment')).toBeInTheDocument()
    })

    it('should disable name input in edit mode', () => {
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          secret={mockSecret}
          environments={defaultEnvironments}
        />
      )

      const nameInput = screen.getByDisplayValue('API_KEY')
      expect(nameInput).toBeDisabled()
    })
  })

  describe('environment selection', () => {
    it('should show all environments as checked by default for new secrets', () => {
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
        />
      )

      defaultEnvironments.forEach((env) => {
        const checkbox = screen.getByLabelText(env)
        expect(checkbox).toBeChecked()
      })
    })

    it('should toggle environment selection', async () => {
      const user = userEvent.setup()
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
        />
      )

      const stagingCheckbox = screen.getByLabelText('staging')
      expect(stagingCheckbox).toBeChecked()

      await user.click(stagingCheckbox)
      expect(stagingCheckbox).not.toBeChecked()

      await user.click(stagingCheckbox)
      expect(stagingCheckbox).toBeChecked()
    })

    it('should select all environments', async () => {
      const user = userEvent.setup()
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
        />
      )

      // First deselect all
      await user.click(screen.getByText('Deselect all'))
      defaultEnvironments.forEach((env) => {
        expect(screen.getByLabelText(env)).not.toBeChecked()
      })

      // Then select all
      await user.click(screen.getByText('Select all'))
      defaultEnvironments.forEach((env) => {
        expect(screen.getByLabelText(env)).toBeChecked()
      })
    })

    it('should show only the secret environment in edit mode', () => {
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          secret={mockSecret}
          environments={defaultEnvironments}
        />
      )

      expect(screen.getByText('production')).toBeInTheDocument()
      expect(screen.queryByText('Select all')).not.toBeInTheDocument()
      expect(screen.queryByText('Deselect all')).not.toBeInTheDocument()
    })
  })

  describe('add new environment', () => {
    it('should show add environment button', () => {
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
        />
      )

      expect(screen.getByText('+ Add environment')).toBeInTheDocument()
    })

    it('should show input when clicking add environment', async () => {
      const user = userEvent.setup()
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
        />
      )

      await user.click(screen.getByText('+ Add environment'))
      expect(screen.getByPlaceholderText('env-name')).toBeInTheDocument()
      expect(screen.getByText('Add')).toBeInTheDocument()
    })

    it('should add new environment and select it', async () => {
      const user = userEvent.setup()
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
        />
      )

      await user.click(screen.getByText('+ Add environment'))
      const input = screen.getByPlaceholderText('env-name')
      await user.type(input, 'testing')
      await user.click(screen.getByText('Add'))

      expect(screen.getByText(/testing/)).toBeInTheDocument()
      expect(screen.getByText('(new)')).toBeInTheDocument()
    })
  })

  describe('form validation', () => {
    it('should show error when name is empty', async () => {
      const user = userEvent.setup()
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
        />
      )

      await user.click(screen.getByText('Create'))

      expect(screen.getByText('Name is required')).toBeInTheDocument()
      expect(mockOnSubmit).not.toHaveBeenCalled()
    })

    it('should show error when value is empty for new secret', async () => {
      const user = userEvent.setup()
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
        />
      )

      const nameInput = screen.getByLabelText('Name')
      await user.type(nameInput, 'MY_SECRET')
      await user.click(screen.getByText('Create'))

      expect(screen.getByText('Value is required')).toBeInTheDocument()
      expect(mockOnSubmit).not.toHaveBeenCalled()
    })

    it('should show error when no environment selected', async () => {
      const user = userEvent.setup()
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
        />
      )

      const nameInput = screen.getByLabelText('Name')
      await user.type(nameInput, 'MY_SECRET')

      const valueInput = screen.getByLabelText('Value')
      await user.type(valueInput, 'secret-value')

      await user.click(screen.getByText('Deselect all'))
      await user.click(screen.getByText('Create'))

      expect(screen.getByText('Select at least one environment')).toBeInTheDocument()
      expect(mockOnSubmit).not.toHaveBeenCalled()
    })

    it('should allow empty value in edit mode', async () => {
      const user = userEvent.setup()
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          secret={mockSecret}
          environments={defaultEnvironments}
        />
      )

      await user.click(screen.getByText('Update'))

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith({
          name: 'API_KEY',
          value: '',
          environments: ['production'],
        })
      })
    })
  })

  describe('form submission', () => {
    it('should call onSubmit with correct data for new secret', async () => {
      const user = userEvent.setup()
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
        />
      )

      await user.type(screen.getByLabelText('Name'), 'my_new_key')
      await user.type(screen.getByLabelText('Value'), 'secret-value-123')

      // Deselect staging
      await user.click(screen.getByLabelText('staging'))

      await user.click(screen.getByText('Create'))

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith({
          name: 'MY_NEW_KEY',
          value: 'secret-value-123',
          environments: ['default', 'production'],
        })
      })
    })

    it('should call onClose after successful submission', async () => {
      const user = userEvent.setup()
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
        />
      )

      await user.type(screen.getByLabelText('Name'), 'TEST_KEY')
      await user.type(screen.getByLabelText('Value'), 'test-value')
      await user.click(screen.getByText('Create'))

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled()
      })
    })

    it('should show error on submission failure', async () => {
      mockOnSubmit.mockRejectedValue(new Error('Network error'))
      const user = userEvent.setup()

      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
        />
      )

      await user.type(screen.getByLabelText('Name'), 'TEST_KEY')
      await user.type(screen.getByLabelText('Value'), 'test-value')
      await user.click(screen.getByText('Create'))

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
      expect(mockOnClose).not.toHaveBeenCalled()
    })
  })

  describe('name input formatting', () => {
    it('should convert name to uppercase', async () => {
      const user = userEvent.setup()
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
        />
      )

      const nameInput = screen.getByLabelText('Name')
      await user.type(nameInput, 'my_api_key')

      expect(nameInput).toHaveValue('MY_API_KEY')
    })

    it('should replace invalid characters with underscores', async () => {
      const user = userEvent.setup()
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
        />
      )

      const nameInput = screen.getByLabelText('Name')
      await user.type(nameInput, 'my-api.key')

      expect(nameInput).toHaveValue('MY_API_KEY')
    })
  })

  describe('paste handling', () => {
    it('should parse KEY=value format on paste', async () => {
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
        />
      )

      const nameInput = screen.getByLabelText('Name')

      fireEvent.paste(nameInput, {
        clipboardData: {
          getData: () => 'DATABASE_URL=postgres://localhost:5432/db',
        },
      })

      await waitFor(() => {
        expect(screen.getByLabelText('Name')).toHaveValue('DATABASE_URL')
        expect(screen.getByLabelText('Value')).toHaveValue('postgres://localhost:5432/db')
      })
    })
  })

  describe('loading state', () => {
    it('should show loading text when isLoading', () => {
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
          isLoading={true}
        />
      )

      expect(screen.getByText('Saving...')).toBeInTheDocument()
    })

    it('should disable submit button when loading', () => {
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
          isLoading={true}
        />
      )

      expect(screen.getByText('Saving...')).toBeDisabled()
    })
  })

  describe('cancel button', () => {
    it('should call onClose when clicking cancel', async () => {
      const user = userEvent.setup()
      render(
        <SecretModal
          isOpen={true}
          onClose={mockOnClose}
          onSubmit={mockOnSubmit}
          environments={defaultEnvironments}
        />
      )

      await user.click(screen.getByText('Cancel'))
      expect(mockOnClose).toHaveBeenCalled()
    })
  })
})
