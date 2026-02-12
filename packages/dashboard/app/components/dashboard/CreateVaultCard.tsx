'use client'

import { Plus } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { CLICommand } from '@/app/components/cli-command'

export function CreateVaultCard() {
  return (
    <Card className="p-4 border-dashed border-2 hover:border-primary/50 transition-colors group">
      {/* Header - matches VaultCard structure */}
      <div className="flex items-start gap-3">
        <div className="size-10 rounded-lg bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
          <Plus className="size-5 text-muted-foreground group-hover:text-primary transition-colors" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground">Create via CLI</h3>
          <p className="text-sm text-muted-foreground">Initialize in your local repo</p>
        </div>
      </div>

      {/* Command box - matches stats row height */}
      <CLICommand variant="compact" className="mt-4" />

      {/* Spacer to match footer height */}
      <div className="h-5 mt-4" />
    </Card>
  )
}
