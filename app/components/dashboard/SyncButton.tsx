'use client'

import { useState } from 'react'
import { RefreshCw, Plus, Pencil, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import type { VaultSync, SyncPreview } from '@/lib/types'
import { api } from '@/lib/api'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface SyncButtonProps {
  sync: VaultSync
  owner: string
  repo: string
  providerLabel: string
  onSyncComplete: () => void
}

type SyncState = 'idle' | 'loading-preview' | 'showing-preview' | 'syncing' | 'success' | 'error'

export function SyncButton({ sync, owner, repo, providerLabel, onSyncComplete }: SyncButtonProps) {
  const [state, setState] = useState<SyncState>('idle')
  const [isOpen, setIsOpen] = useState(false)
  const [preview, setPreview] = useState<SyncPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null)

  const handleOpenModal = async () => {
    setIsOpen(true)
    setState('loading-preview')
    setError(null)
    setPreview(null)
    setResult(null)

    trackEvent(AnalyticsEvents.SYNC_PREVIEW, {
      provider: sync.provider,
      keywayEnvironment: sync.keyway_environment,
      providerEnvironment: sync.provider_environment,
    })

    try {
      const previewData = await api.getSyncPreview(
        owner,
        repo,
        sync.connection_id,
        sync.project_id,
        sync.keyway_environment,
        sync.provider_environment
      )
      setPreview(previewData)
      setState('showing-preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preview')
      setState('error')
      trackEvent(AnalyticsEvents.SYNC_ERROR, {
        provider: sync.provider,
        error: err instanceof Error ? err.message : 'Failed to load preview',
        phase: 'preview',
      })
    }
  }

  const handleSync = async () => {
    setState('syncing')
    setError(null)

    trackEvent(AnalyticsEvents.SYNC_EXECUTE, {
      provider: sync.provider,
      keywayEnvironment: sync.keyway_environment,
      providerEnvironment: sync.provider_environment,
      toCreate: preview?.toCreate.length ?? 0,
      toUpdate: preview?.toUpdate.length ?? 0,
    })

    try {
      const syncResult = await api.executeSync(
        owner,
        repo,
        sync.connection_id,
        sync.project_id,
        sync.keyway_environment,
        sync.provider_environment
      )

      if (syncResult.status === 'error') {
        setError(syncResult.error || 'Sync failed')
        setState('error')
        trackEvent(AnalyticsEvents.SYNC_ERROR, {
          provider: sync.provider,
          error: syncResult.error || 'Sync failed',
          phase: 'execute',
        })
      } else {
        setResult({ created: syncResult.created, updated: syncResult.updated })
        setState('success')
        trackEvent(AnalyticsEvents.SYNC_SUCCESS, {
          provider: sync.provider,
          created: syncResult.created,
          updated: syncResult.updated,
        })
        // Auto-close after success and refresh parent
        setTimeout(() => {
          setIsOpen(false)
          onSyncComplete()
        }, 1500)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
      setState('error')
      trackEvent(AnalyticsEvents.SYNC_ERROR, {
        provider: sync.provider,
        error: err instanceof Error ? err.message : 'Sync failed',
        phase: 'execute',
      })
    }
  }

  const handleClose = () => {
    setIsOpen(false)
    setState('idle')
    setPreview(null)
    setError(null)
    setResult(null)
  }

  const hasChanges = preview && (preview.toCreate.length > 0 || preview.toUpdate.length > 0)

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleOpenModal}
        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <RefreshCw className="w-3 h-3 mr-1" />
        Sync
      </Button>

      <Dialog open={isOpen} onOpenChange={(open) => !open && state !== 'syncing' && handleClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sync to {providerLabel}</DialogTitle>
          </DialogHeader>

          <div className="py-4">
            {/* Loading state */}
            {state === 'loading-preview' && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Loading preview...</span>
              </div>
            )}

            {/* Error state */}
            {state === 'error' && error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4">
                <div className="flex items-start gap-3">
                  <XCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-destructive">Error</p>
                    <p className="text-sm text-muted-foreground mt-1">{error}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Preview state */}
            {state === 'showing-preview' && preview && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Push secrets from <span className="font-medium text-foreground">{sync.keyway_environment}</span> to {providerLabel}&apos;s <span className="font-medium text-foreground">{sync.provider_environment}</span> environment.
                </p>

                {!hasChanges ? (
                  <div className="rounded-lg bg-muted/50 p-4 text-center">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                    <p className="font-medium">Already in sync</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      No changes needed. All secrets are up to date.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {preview.toCreate.length > 0 && (
                      <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/20 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Plus className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                          <span className="font-medium text-emerald-800 dark:text-emerald-300">
                            {preview.toCreate.length} secret{preview.toCreate.length > 1 ? 's' : ''} to create
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {preview.toCreate.map((name) => (
                            <span
                              key={name}
                              className="inline-block px-2 py-0.5 text-xs font-mono bg-emerald-100 dark:bg-emerald-800/50 text-emerald-700 dark:text-emerald-300 rounded"
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {preview.toUpdate.length > 0 && (
                      <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Pencil className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                          <span className="font-medium text-amber-800 dark:text-amber-300">
                            {preview.toUpdate.length} secret{preview.toUpdate.length > 1 ? 's' : ''} to update
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {preview.toUpdate.map((name) => (
                            <span
                              key={name}
                              className="inline-block px-2 py-0.5 text-xs font-mono bg-amber-100 dark:bg-amber-800/50 text-amber-700 dark:text-amber-300 rounded"
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {preview.toSkip.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {preview.toSkip.length} secret{preview.toSkip.length > 1 ? 's' : ''} already up to date
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Syncing state */}
            {state === 'syncing' && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                <span className="ml-2 text-muted-foreground">Syncing secrets...</span>
              </div>
            )}

            {/* Success state */}
            {state === 'success' && result && (
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 p-4 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                <p className="font-medium text-emerald-800 dark:text-emerald-300">Sync complete!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {result.created > 0 && `${result.created} created`}
                  {result.created > 0 && result.updated > 0 && ', '}
                  {result.updated > 0 && `${result.updated} updated`}
                  {result.created === 0 && result.updated === 0 && 'No changes needed'}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            {state === 'showing-preview' && (
              <>
                <Button variant="outline" onClick={handleClose}>
                  {hasChanges ? 'Cancel' : 'Close'}
                </Button>
                {hasChanges && (
                  <Button onClick={handleSync} className="bg-emerald-600 hover:bg-emerald-500 text-white">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Sync now
                  </Button>
                )}
              </>
            )}
            {state === 'error' && (
              <>
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button onClick={handleOpenModal} variant="outline">
                  Retry
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
