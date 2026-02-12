import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CreateVaultCard } from '../app/components/dashboard/CreateVaultCard'

// Mock CLI command
vi.mock('../app/components/cli-command', () => ({
  CLICommand: ({ variant, className }: { variant?: string; className?: string }) => (
    <div data-testid="cli-command" data-variant={variant} className={className}>
      CLI Command
    </div>
  ),
}))

describe('CreateVaultCard', () => {
  it('should render the card title', () => {
    render(<CreateVaultCard />)

    expect(screen.getByText('Create via CLI')).toBeInTheDocument()
  })

  it('should render the card description', () => {
    render(<CreateVaultCard />)

    expect(screen.getByText('Initialize in your local repo')).toBeInTheDocument()
  })

  it('should render the CLI command component', () => {
    render(<CreateVaultCard />)

    expect(screen.getByTestId('cli-command')).toBeInTheDocument()
  })

  it('should use compact variant for CLI command', () => {
    render(<CreateVaultCard />)

    const cliCommand = screen.getByTestId('cli-command')
    expect(cliCommand).toHaveAttribute('data-variant', 'compact')
  })

  it('should render a card element', () => {
    render(<CreateVaultCard />)

    // Card should be present in the DOM
    const card = document.querySelector('.border-dashed')
    expect(card).toBeInTheDocument()
  })
})
