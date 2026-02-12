import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CLICommand } from '../app/components/cli-command'

// Mock the cli module
vi.mock('../lib/cli', () => ({
  CLI_INSTALL: {
    mac: {
      command: 'brew install keywaysh/tap/keyway',
      copyable: true,
    },
    linux: {
      command: 'curl -fsSL https://keyway.sh/install.sh | sh',
      copyable: true,
    },
    windows: {
      command: 'Download for Windows',
      copyable: false,
      href: 'https://github.com/keywaysh/cli/releases/latest',
    },
  },
  CLI_COMMANDS: {
    init: 'keyway init',
    pull: 'keyway pull',
    sync: 'keyway sync',
    run: 'keyway run -- npm start',
  },
  CLI_DOCS_URL: 'https://docs.keyway.sh/installation',
  detectPlatform: () => 'mac',
}))

// Mock clipboard API
const mockWriteText = vi.fn()
Object.assign(navigator, {
  clipboard: {
    writeText: mockWriteText,
  },
})

describe('CLICommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('default variant', () => {
    it('should render with default variant', () => {
      render(<CLICommand />)

      expect(screen.getByText('brew install keywaysh/tap/keyway')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Copy command/i })).toBeInTheDocument()
    })

    it('should show docs link by default', () => {
      render(<CLICommand />)

      expect(screen.getByText(/Then run:/)).toBeInTheDocument()
      expect(screen.getByText('Other install options')).toBeInTheDocument()
    })

    it('should hide docs when showDocs=false', () => {
      render(<CLICommand showDocs={false} />)

      expect(screen.queryByText(/Then run:/)).not.toBeInTheDocument()
      expect(screen.queryByText('Other install options')).not.toBeInTheDocument()
    })

    it('should apply custom className', () => {
      const { container } = render(<CLICommand className="custom-class" />)

      expect(container.firstChild).toHaveClass('custom-class')
    })
  })

  describe('marketing variant', () => {
    it('should render marketing variant', () => {
      render(<CLICommand variant="marketing" />)

      expect(screen.getByText('brew install keywaysh/tap/keyway')).toBeInTheDocument()
      expect(screen.getByText('Copy')).toBeInTheDocument()
    })

    it('should show docs link in marketing variant', () => {
      render(<CLICommand variant="marketing" />)

      expect(screen.getByText(/Then run:/)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Other install options' })).toHaveAttribute(
        'href',
        'https://docs.keyway.sh/installation'
      )
    })
  })

  describe('compact variant', () => {
    it('should render compact variant', () => {
      render(<CLICommand variant="compact" />)

      expect(screen.getByText('brew install keywaysh/tap/keyway')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Copy command/i })).toBeInTheDocument()
    })

    it('should not show docs in compact variant', () => {
      render(<CLICommand variant="compact" />)

      expect(screen.queryByText(/Then run:/)).not.toBeInTheDocument()
    })
  })

  describe('copy functionality', () => {
    it('should have copy button', () => {
      render(<CLICommand />)

      const copyButton = screen.getByRole('button', { name: /Copy command/i })
      expect(copyButton).toBeInTheDocument()
    })

    it('should call clipboard writeText on copy', async () => {
      mockWriteText.mockResolvedValueOnce(undefined)
      render(<CLICommand />)

      const copyButton = screen.getByRole('button', { name: /Copy command/i })
      fireEvent.click(copyButton)

      expect(mockWriteText).toHaveBeenCalledWith('brew install keywaysh/tap/keyway')
    })
  })
})
