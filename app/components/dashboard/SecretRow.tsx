'use client'

import { useState, memo } from 'react'
import Image from 'next/image'
import { Pencil, Trash2, Eye } from 'lucide-react'
import type { Secret } from '@/lib/types'
import { getEnvironmentColor } from '@/lib/environment-colors'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
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

interface SecretRowProps {
  secret: Secret
  onView?: (secret: Secret) => void
  onEdit?: (secret: Secret) => void
  onDelete?: (secret: Secret) => void
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export const SecretRow = memo(function SecretRow({
  secret,
  onView,
  onEdit,
  onDelete,
}: SecretRowProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const envColors = getEnvironmentColor(secret.environment)

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      await onDelete?.(secret)
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm font-medium text-foreground">
              {secret.name}
            </span>
            <Badge
              variant="secondary"
              className={`text-xs border ${envColors.bg} ${envColors.border} ${envColors.text}`}
            >
              {secret.environment}
            </Badge>
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <span>Created {formatDate(secret.created_at)} · Updated {formatDate(secret.updated_at)}</span>
            {secret.last_modified_by && (
              <>
                <span>by</span>
                {secret.last_modified_by.avatar_url && (
                  <Image
                    src={secret.last_modified_by.avatar_url}
                    alt={secret.last_modified_by.username}
                    width={16}
                    height={16}
                    className="size-4 rounded-full"
                  />
                )}
                <span className="font-medium">@{secret.last_modified_by.username}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-1">
          {onView && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onView(secret)}
              className="h-10 w-10 sm:h-8 sm:w-8 text-muted-foreground hover:text-foreground"
              title="View secret"
            >
              <Eye className="h-4 w-4" />
              <span className="sr-only">View secret</span>
            </Button>
          )}
          {onEdit && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(secret)}
              className="h-10 w-10 sm:h-8 sm:w-8 text-muted-foreground hover:text-foreground"
              title="Edit secret"
            >
              <Pencil className="h-4 w-4" />
              <span className="sr-only">Edit secret</span>
            </Button>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowDeleteConfirm(true)}
              className="h-10 w-10 sm:h-8 sm:w-8 text-muted-foreground hover:text-destructive"
              title="Delete secret"
            >
              <Trash2 className="h-4 w-4" />
              <span className="sr-only">Delete secret</span>
            </Button>
          )}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete secret?</AlertDialogTitle>
            <AlertDialogDescription>
              <code className="font-mono">{secret.name}</code> will be moved to trash.
              You can restore it within 30 days.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
})

export function SecretRowSkeleton() {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div className="flex-1">
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="mt-2 h-3 w-48" />
      </div>
      <div className="flex gap-1">
        <Skeleton className="w-8 h-8 rounded-lg" />
        <Skeleton className="w-8 h-8 rounded-lg" />
        <Skeleton className="w-8 h-8 rounded-lg" />
        <Skeleton className="w-8 h-8 rounded-lg" />
      </div>
    </div>
  )
}
