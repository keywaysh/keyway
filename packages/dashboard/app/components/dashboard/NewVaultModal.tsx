'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CLICommand } from '@/app/components/cli-command'

interface NewVaultModalProps {
  isOpen: boolean
  onClose: () => void
}

export function NewVaultModal({ isOpen, onClose }: NewVaultModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a new vault</DialogTitle>
          <DialogDescription>
            Install Keyway CLI and run init in your project folder.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <CLICommand showDocs={false} />

          <div className="text-sm text-muted-foreground space-y-2">
            <p>This will:</p>
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>Authenticate you via GitHub</li>
              <li>Create a vault linked to your repository</li>
              <li>Push your local <code className="text-primary bg-primary/10 px-1 rounded">.env</code> to the vault</li>
            </ol>
          </div>

          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
