'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { Eye, EyeOff, Copy, Loader2, History, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import type { Secret, SecretVersion } from '@/lib/types'
import { api } from '@/lib/api'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
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
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

interface ViewSecretModalProps {
  isOpen: boolean
  onClose: () => void
  secret: Secret | null
  owner: string
  repo: string
  canWrite?: boolean
  onSecretUpdated?: () => void
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function ViewSecretModal({
  isOpen,
  onClose,
  secret,
  owner,
  repo,
  canWrite = false,
  onSecretUpdated,
}: ViewSecretModalProps) {
  const [value, setValue] = useState<string | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isCopying, setIsCopying] = useState(false)

  // Version history state
  const [showHistory, setShowHistory] = useState(false)
  const [versions, setVersions] = useState<SecretVersion[]>([])
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState<SecretVersion | null>(null)
  const [versionValue, setVersionValue] = useState<string | null>(null)
  const [isLoadingVersionValue, setIsLoadingVersionValue] = useState(false)
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setValue(null)
      setIsVisible(false)
      setShowHistory(false)
      setVersions([])
      setSelectedVersion(null)
      setVersionValue(null)
    }
  }, [isOpen])

  const handleReveal = async () => {
    if (!secret) return

    // Toggle visibility if already fetched
    if (value) {
      setIsVisible(!isVisible)
      return
    }

    setIsLoading(true)
    try {
      const { value: v } = await api.getSecretValue(owner, repo, secret.id)
      setValue(v)
      setIsVisible(true)
      trackEvent(AnalyticsEvents.SECRET_VIEW, { secretName: secret.name })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load secret')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!secret) return

    setIsCopying(true)
    try {
      let valueToCopy = value
      if (!valueToCopy) {
        const { value: v } = await api.getSecretValue(owner, repo, secret.id)
        valueToCopy = v
        setValue(v)
      }
      await navigator.clipboard.writeText(valueToCopy)
      toast.success('Secret copied to clipboard')
      trackEvent(AnalyticsEvents.SECRET_COPY, { secretName: secret.name })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to copy secret')
    } finally {
      setIsCopying(false)
    }
  }

  const handleToggleHistory = async () => {
    if (!secret) return

    if (!showHistory && versions.length === 0) {
      setIsLoadingVersions(true)
      try {
        const fetchedVersions = await api.getSecretVersions(owner, repo, secret.id)
        setVersions(fetchedVersions)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to load version history')
      } finally {
        setIsLoadingVersions(false)
      }
    }
    setShowHistory(!showHistory)
    setSelectedVersion(null)
    setVersionValue(null)
  }

  const handleSelectVersion = async (version: SecretVersion) => {
    if (!secret) return

    if (selectedVersion?.id === version.id) {
      setSelectedVersion(null)
      setVersionValue(null)
      return
    }

    setSelectedVersion(version)
    setIsLoadingVersionValue(true)
    try {
      const { value } = await api.getSecretVersionValue(owner, repo, secret.id, version.id)
      setVersionValue(value)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load version value')
      setSelectedVersion(null)
    } finally {
      setIsLoadingVersionValue(false)
    }
  }

  const handleRestore = async () => {
    if (!secret || !selectedVersion) return

    setIsRestoring(true)
    try {
      await api.restoreSecretVersion(owner, repo, secret.id, selectedVersion.id)
      toast.success(`Restored to version ${selectedVersion.version_number}`)
      trackEvent(AnalyticsEvents.SECRET_VERSION_RESTORED, {
        secretName: secret.name,
        versionNumber: selectedVersion.version_number,
      })
      setShowRestoreConfirm(false)
      onSecretUpdated?.()
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to restore version')
    } finally {
      setIsRestoring(false)
    }
  }

  if (!secret) return null

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>View Secret</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Name */}
            <div className="space-y-2">
              <Label>Name</Label>
              <div className="rounded-xs border border-input bg-muted/50 px-3 py-2">
                <span className="font-mono text-sm">{secret.name}</span>
              </div>
            </div>

            {/* Environment */}
            <div className="space-y-2">
              <Label>Environment</Label>
              <div>
                <Badge variant="secondary">{secret.environment}</Badge>
              </div>
            </div>

            {/* Value */}
            <div className="space-y-2">
              <Label>Current Value</Label>
              <div className="rounded-xs border border-input bg-muted/50 px-3 py-2 min-h-[80px] max-h-[200px] overflow-auto">
                <pre className="font-mono text-sm whitespace-pre-wrap break-all">
                  {isVisible && value ? value : '••••••••••••••••••••••••••••••••'}
                </pre>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleReveal}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : isVisible ? (
                    <EyeOff className="size-4 mr-2" />
                  ) : (
                    <Eye className="size-4 mr-2" />
                  )}
                  {isVisible ? 'Hide' : 'Show'}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  disabled={isCopying}
                >
                  {isCopying ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Copy className="size-4 mr-2" />
                  )}
                  Copy
                </Button>
              </div>
            </div>

            {/* Metadata */}
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Created: {formatDate(secret.created_at)}</p>
              <p>Updated: {formatDate(secret.updated_at)}</p>
            </div>

            <Separator />

            {/* Version History Toggle */}
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-between"
              onClick={handleToggleHistory}
              disabled={isLoadingVersions}
            >
              <span className="flex items-center gap-2">
                <History className="size-4" />
                Version History
              </span>
              {isLoadingVersions ? (
                <Loader2 className="size-4 animate-spin" />
              ) : showHistory ? (
                <ChevronUp className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </Button>

            {/* Version History Panel */}
            {showHistory && (
              <div className="space-y-3 pl-2">
                {versions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No previous versions</p>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {versions.map((version) => (
                      <div
                        key={version.id}
                        className={`p-3 rounded-xs border cursor-pointer transition-colors ${
                          selectedVersion?.id === version.id
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-muted-foreground/50'
                        }`}
                        onClick={() => handleSelectVersion(version)}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            Version {version.version_number}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(version.created_at)}
                          </span>
                        </div>
                        {version.created_by && (
                          <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                            {version.created_by.avatar_url && (
                              <Image
                                src={version.created_by.avatar_url}
                                alt={version.created_by.username}
                                width={16}
                                height={16}
                                className="size-4 rounded-full"
                              />
                            )}
                            <span>@{version.created_by.username}</span>
                          </div>
                        )}

                        {/* Selected version value preview */}
                        {selectedVersion?.id === version.id && (
                          <div className="mt-3 space-y-2">
                            <div className="rounded-xs border border-input bg-muted/50 px-3 py-2 max-h-[100px] overflow-auto">
                              {isLoadingVersionValue ? (
                                <div className="flex items-center gap-2">
                                  <Loader2 className="size-4 animate-spin" />
                                  <span className="text-sm text-muted-foreground">Loading...</span>
                                </div>
                              ) : (
                                <pre className="font-mono text-xs whitespace-pre-wrap break-all">
                                  {versionValue}
                                </pre>
                              )}
                            </div>
                            {canWrite && versionValue && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setShowRestoreConfirm(true)
                                }}
                              >
                                <RotateCcw className="size-4 mr-2" />
                                Restore this version
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore Confirmation Dialog */}
      <AlertDialog open={showRestoreConfirm} onOpenChange={setShowRestoreConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore version?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace the current value of <code className="font-mono bg-muted px-1 rounded-xs">{secret.name}</code> with
              version {selectedVersion?.version_number}. The current value will be saved as a new version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRestoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestore} disabled={isRestoring}>
              {isRestoring ? 'Restoring...' : 'Restore'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
