'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, RotateCcw, Trash2, Clock } from 'lucide-react'
import type { TrashedSecret } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

interface TrashSectionProps {
  trashedSecrets: TrashedSecret[]
  onRestore: (secret: TrashedSecret) => Promise<void>
  onPermanentDelete: (secret: TrashedSecret) => Promise<void>
  onEmptyTrash: () => Promise<void>
  canWrite: boolean
}

export function TrashSection({
  trashedSecrets,
  onRestore,
  onPermanentDelete,
  onEmptyTrash,
  canWrite,
}: TrashSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<TrashedSecret | null>(null)
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false)
  const [isRestoring, setIsRestoring] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState<string | null>(null)
  const [isEmptying, setIsEmptying] = useState(false)

  if (trashedSecrets.length === 0) {
    return null
  }

  const handleRestore = async (secret: TrashedSecret) => {
    setIsRestoring(secret.id)
    try {
      await onRestore(secret)
      trackEvent(AnalyticsEvents.TRASH_RESTORE, { secretName: secret.name })
    } finally {
      setIsRestoring(null)
    }
  }

  const handlePermanentDelete = async () => {
    if (!confirmDelete) return
    setIsDeleting(confirmDelete.id)
    try {
      await onPermanentDelete(confirmDelete)
      trackEvent(AnalyticsEvents.TRASH_PERMANENT_DELETE, { secretName: confirmDelete.name })
    } finally {
      setIsDeleting(null)
      setConfirmDelete(null)
    }
  }

  const handleEmptyTrash = async () => {
    setIsEmptying(true)
    try {
      await onEmptyTrash()
      trackEvent(AnalyticsEvents.TRASH_EMPTY, { count: trashedSecrets.length })
    } finally {
      setIsEmptying(false)
      setConfirmEmptyTrash(false)
    }
  }

  const handleToggleExpand = () => {
    const newExpanded = !isExpanded
    setIsExpanded(newExpanded)
    if (newExpanded) {
      trackEvent(AnalyticsEvents.TRASH_VIEW, { count: trashedSecrets.length })
    }
  }

  return (
    <>
      <Card className="mt-6 border-dashed border-muted-foreground/30">
        <CardHeader className="py-3">
          <div className="flex items-center justify-between w-full">
            <button
              onClick={handleToggleExpand}
              className="flex items-center gap-2 text-left"
              aria-expanded={isExpanded}
            >
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                <Trash2 className="w-4 h-4" />
                Recently deleted ({trashedSecrets.length})
              </CardTitle>
            </button>
            {isExpanded && canWrite && trashedSecrets.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-destructive hover:text-destructive"
                onClick={() => setConfirmEmptyTrash(true)}
              >
                Empty trash
              </Button>
            )}
          </div>
        </CardHeader>

        {isExpanded && (
          <CardContent className="pt-0">
            <div className="space-y-1">
              {trashedSecrets.map((secret) => (
                <div
                  key={secret.id}
                  className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <code className="text-sm font-mono text-muted-foreground line-through truncate block">
                        {secret.name}
                      </code>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <span>{secret.environment}</span>
                        <span className="text-muted-foreground/50">·</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {secret.days_remaining > 0
                            ? `${secret.days_remaining}d left`
                            : 'Expires soon'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {canWrite && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => handleRestore(secret)}
                        disabled={isRestoring === secret.id}
                      >
                        <RotateCcw className={cn('w-3 h-3 mr-1', isRestoring === secret.id && 'animate-spin')} />
                        Restore
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() => setConfirmDelete(secret)}
                        disabled={isDeleting === secret.id}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground mt-3">
              Deleted secrets are automatically removed after 30 days.
            </p>
          </CardContent>
        )}
      </Card>

      {/* Permanent delete confirmation */}
      <AlertDialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete secret?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <code className="font-mono">{confirmDelete?.name}</code> from{' '}
              <span className="font-medium">{confirmDelete?.environment}</span>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handlePermanentDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete forever'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Empty trash confirmation */}
      <AlertDialog open={confirmEmptyTrash} onOpenChange={setConfirmEmptyTrash}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Empty trash?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {trashedSecrets.length} secrets in the trash. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleEmptyTrash}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isEmptying ? 'Emptying...' : 'Empty trash'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
