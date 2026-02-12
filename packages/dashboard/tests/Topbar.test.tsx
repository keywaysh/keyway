import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Topbar } from '../app/components/dashboard/Topbar'

// Mock Crisp
vi.mock('@/lib/crisp', () => ({
  openFeedback: vi.fn(),
}))

// Mock NewVaultModal
vi.mock('../app/components/dashboard/NewVaultModal', () => ({
  NewVaultModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
    isOpen ? (
      <div data-testid="new-vault-modal">
        <button onClick={onClose}>Close Modal</button>
      </div>
    ) : null
  ),
}))

import { openFeedback } from '@/lib/crisp'

describe('Topbar', () => {
  const mockOnMenuClick = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render with default title', () => {
      render(<Topbar onMenuClick={mockOnMenuClick} />)

      expect(screen.getByText('Vaults')).toBeInTheDocument()
    })

    it('should render with custom title', () => {
      render(<Topbar onMenuClick={mockOnMenuClick} title="Settings" />)

      expect(screen.getByText('Settings')).toBeInTheDocument()
    })

    it('should render menu button', () => {
      render(<Topbar onMenuClick={mockOnMenuClick} />)

      expect(screen.getByRole('button', { name: /open menu/i })).toBeInTheDocument()
    })

    it('should render feedback button', () => {
      render(<Topbar onMenuClick={mockOnMenuClick} />)

      expect(screen.getByText('Feedback')).toBeInTheDocument()
    })

    it('should render new vault button by default', () => {
      render(<Topbar onMenuClick={mockOnMenuClick} />)

      expect(screen.getByText('New Vault')).toBeInTheDocument()
    })

    it('should hide new vault button when showNewVault is false', () => {
      render(<Topbar onMenuClick={mockOnMenuClick} showNewVault={false} />)

      expect(screen.queryByText('New Vault')).not.toBeInTheDocument()
    })
  })

  describe('interactions', () => {
    it('should call onMenuClick when menu button clicked', async () => {
      const user = userEvent.setup()
      render(<Topbar onMenuClick={mockOnMenuClick} />)

      await user.click(screen.getByRole('button', { name: /open menu/i }))

      expect(mockOnMenuClick).toHaveBeenCalled()
    })

    it('should call openFeedback when feedback button clicked', async () => {
      const user = userEvent.setup()
      render(<Topbar onMenuClick={mockOnMenuClick} />)

      await user.click(screen.getByText('Feedback'))

      expect(openFeedback).toHaveBeenCalled()
    })

    it('should open new vault modal when new vault button clicked', async () => {
      const user = userEvent.setup()
      render(<Topbar onMenuClick={mockOnMenuClick} />)

      expect(screen.queryByTestId('new-vault-modal')).not.toBeInTheDocument()

      await user.click(screen.getByText('New Vault'))

      await waitFor(() => {
        expect(screen.getByTestId('new-vault-modal')).toBeInTheDocument()
      })
    })

    it('should close new vault modal', async () => {
      const user = userEvent.setup()
      render(<Topbar onMenuClick={mockOnMenuClick} />)

      await user.click(screen.getByText('New Vault'))

      await waitFor(() => {
        expect(screen.getByTestId('new-vault-modal')).toBeInTheDocument()
      })

      await user.click(screen.getByText('Close Modal'))

      await waitFor(() => {
        expect(screen.queryByTestId('new-vault-modal')).not.toBeInTheDocument()
      })
    })
  })
})
