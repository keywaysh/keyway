import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GitHubAppNotInstalledState } from '../app/components/dashboard/GitHubAppNotInstalledState'

describe('GitHubAppNotInstalledState', () => {
  const mockOnRetry = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Header', () => {
    it('should render the title', () => {
      render(<GitHubAppNotInstalledState error="Some error" onRetry={mockOnRetry} />)

      expect(screen.getByText('GitHub App Not Installed')).toBeInTheDocument()
    })

    it('should render install instructions', () => {
      render(<GitHubAppNotInstalledState error="Some error" onRetry={mockOnRetry} />)

      expect(screen.getByText(/Install the app to grant Keyway access/)).toBeInTheDocument()
    })
  })

  describe('Repo Name Parsing', () => {
    it('should extract repo name from error message', () => {
      render(<GitHubAppNotInstalledState error="GitHub App not installed for owner/my-repo" onRetry={mockOnRetry} />)

      expect(screen.getByText('owner/my-repo')).toBeInTheDocument()
    })

    it('should show generic message without repo name', () => {
      render(<GitHubAppNotInstalledState error="Some other error" onRetry={mockOnRetry} />)

      expect(screen.getByText('The Keyway GitHub App needs to be installed to access your repositories.')).toBeInTheDocument()
    })
  })

  describe('Install URL Parsing', () => {
    it('should use extracted URL from error message', () => {
      render(
        <GitHubAppNotInstalledState
          error="Install at https://github.com/apps/keyway/installations/select_target"
          onRetry={mockOnRetry}
        />
      )

      const link = screen.getByRole('link', { name: /Install GitHub App/i })
      expect(link).toHaveAttribute('href', 'https://github.com/apps/keyway/installations/select_target')
    })

    it('should use default URL when not in error', () => {
      render(<GitHubAppNotInstalledState error="Some error" onRetry={mockOnRetry} />)

      const link = screen.getByRole('link', { name: /Install GitHub App/i })
      expect(link).toHaveAttribute('href', 'https://github.com/apps/keyway/installations/new')
    })
  })

  describe('Buttons', () => {
    it('should render Install GitHub App button', () => {
      render(<GitHubAppNotInstalledState error="Some error" onRetry={mockOnRetry} />)

      expect(screen.getByText('Install GitHub App')).toBeInTheDocument()
    })

    it('should render Retry button', () => {
      render(<GitHubAppNotInstalledState error="Some error" onRetry={mockOnRetry} />)

      expect(screen.getByText('Retry')).toBeInTheDocument()
    })

    it('should call onRetry when Retry button is clicked', () => {
      render(<GitHubAppNotInstalledState error="Some error" onRetry={mockOnRetry} />)

      fireEvent.click(screen.getByText('Retry'))
      expect(mockOnRetry).toHaveBeenCalledTimes(1)
    })

    it('should open install link in new tab', () => {
      render(<GitHubAppNotInstalledState error="Some error" onRetry={mockOnRetry} />)

      const link = screen.getByRole('link', { name: /Install GitHub App/i })
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })
})
