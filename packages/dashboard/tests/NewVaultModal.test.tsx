import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NewVaultModal } from '../app/components/dashboard/NewVaultModal'

// Mock CLI command component
vi.mock('../app/components/cli-command', () => ({
  CLICommand: ({ showDocs }: { showDocs?: boolean }) => (
    <div data-testid="cli-command">CLI Command (showDocs: {String(showDocs)})</div>
  ),
}))

describe('NewVaultModal', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('when closed', () => {
    it('should not render content when closed', () => {
      render(<NewVaultModal isOpen={false} onClose={mockOnClose} />)

      expect(screen.queryByText('Create a new vault')).not.toBeInTheDocument()
    })
  })

  describe('when open', () => {
    it('should render modal title', () => {
      render(<NewVaultModal isOpen={true} onClose={mockOnClose} />)

      expect(screen.getByText('Create a new vault')).toBeInTheDocument()
    })

    it('should render modal description', () => {
      render(<NewVaultModal isOpen={true} onClose={mockOnClose} />)

      expect(screen.getByText('Install Keyway CLI and run init in your project folder.')).toBeInTheDocument()
    })

    it('should render CLI command component', () => {
      render(<NewVaultModal isOpen={true} onClose={mockOnClose} />)

      expect(screen.getByTestId('cli-command')).toBeInTheDocument()
      expect(screen.getByText(/showDocs: false/)).toBeInTheDocument()
    })

    it('should render instruction steps', () => {
      render(<NewVaultModal isOpen={true} onClose={mockOnClose} />)

      expect(screen.getByText('This will:')).toBeInTheDocument()
      expect(screen.getByText('Authenticate you via GitHub')).toBeInTheDocument()
      expect(screen.getByText('Create a vault linked to your repository')).toBeInTheDocument()
      expect(screen.getByText(/Push your local/)).toBeInTheDocument()
    })

    it('should render .env code reference', () => {
      render(<NewVaultModal isOpen={true} onClose={mockOnClose} />)

      expect(screen.getByText('.env')).toBeInTheDocument()
    })

    it('should render close button', () => {
      render(<NewVaultModal isOpen={true} onClose={mockOnClose} />)

      const closeButtons = screen.getAllByRole('button', { name: /close/i })
      expect(closeButtons.length).toBeGreaterThan(0)
    })

    it('should call onClose when close button is clicked', () => {
      render(<NewVaultModal isOpen={true} onClose={mockOnClose} />)

      // Get all Close buttons and pick the variant one (with the explicit "Close" text, not X icon)
      const closeButtons = screen.getAllByRole('button', { name: /close/i })
      // Find the one that contains text "Close" (not the icon button with sr-only text)
      const explicitCloseButton = closeButtons.find(btn => btn.textContent === 'Close')
      expect(explicitCloseButton).toBeDefined()
      fireEvent.click(explicitCloseButton!)
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })
  })
})
