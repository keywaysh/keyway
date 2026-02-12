'use client'

import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { Vault } from '@/lib/types'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface DeleteVaultModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
  vault: Vault | null
}

export function DeleteVaultModal({ isOpen, onClose, onConfirm, vault }: DeleteVaultModalProps) {
  const [confirmText, setConfirmText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasSecrets = vault && vault.secrets_count > 0
  const expectedText = vault ? `${vault.repo_owner}/${vault.repo_name}` : ''
  const canDelete = !hasSecrets || confirmText === expectedText

  useEffect(() => {
    setConfirmText('')
    setError(null)
    setIsDeleting(false)
  }, [isOpen, vault])

  const handleDelete = async () => {
    if (!canDelete || !vault) return

    setIsDeleting(true)
    setError(null)

    try {
      await onConfirm()
      trackEvent(AnalyticsEvents.VAULT_DELETE, {
        repo: `${vault.repo_owner}/${vault.repo_name}`,
        secretsCount: vault.secrets_count,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete vault')
      setIsDeleting(false)
    }
  }

  if (!vault) return null

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-destructive">
            Delete Vault
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              {error && (
                <div className="mb-4 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              {hasSecrets ? (
                <>
                  <div className="mb-4 rounded-lg bg-destructive/10 border border-destructive/20 p-3">
                    <div className="flex gap-3">
                      <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                      <div className="text-sm">
                        <p className="font-medium text-destructive">This action cannot be undone</p>
                        <p className="text-muted-foreground mt-1">
                          This will permanently delete the <span className="font-mono text-foreground">{vault.repo_owner}/{vault.repo_name}</span> vault and all <span className="font-semibold text-foreground">{vault.secrets_count} secret{vault.secrets_count > 1 ? 's' : ''}</span> it contains.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm-delete" className="text-muted-foreground">
                      To confirm, type <span className="font-mono text-foreground">{expectedText}</span> below:
                    </Label>
                    <Input
                      id="confirm-delete"
                      type="text"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder={expectedText}
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono"
                    />
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground">
                  Are you sure you want to delete the vault <span className="font-mono text-foreground">{vault.repo_owner}/{vault.repo_name}</span>? This vault is empty.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!canDelete || isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete vault'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
