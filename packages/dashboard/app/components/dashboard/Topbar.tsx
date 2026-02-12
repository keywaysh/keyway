'use client'

import { useState } from 'react'
import { Menu, Plus, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NewVaultModal } from './NewVaultModal'
import { openFeedback } from '@/lib/crisp'

interface TopbarProps {
  onMenuClick: () => void
  title?: string
  showNewVault?: boolean
}

export function Topbar({ onMenuClick, title = 'Vaults', showNewVault = true }: TopbarProps) {
  const [isNewVaultOpen, setIsNewVaultOpen] = useState(false)

  return (
    <>
      <header className="sticky top-0 z-40 h-14 min-h-[56px] shrink-0 border-b border-border bg-background/80 backdrop-blur-sm flex items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            className="md:hidden h-8 w-8 -ml-1"
          >
            <Menu className="h-5 w-5" />
            <span className="sr-only">Open menu</span>
          </Button>
          <h1 className="text-sm font-semibold text-foreground">{title}</h1>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={openFeedback}
            className="text-muted-foreground hover:text-foreground"
          >
            <MessageSquare className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Feedback</span>
          </Button>

          {showNewVault && (
            <Button size="sm" onClick={() => setIsNewVaultOpen(true)}>
              <Plus className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">New Vault</span>
            </Button>
          )}
        </div>
      </header>

      <NewVaultModal
        isOpen={isNewVaultOpen}
        onClose={() => setIsNewVaultOpen(false)}
      />
    </>
  )
}
