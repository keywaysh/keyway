'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { api } from '@/lib/api'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import type { Vault, Secret } from '@/lib/types'
import {
  DashboardLayout,
  ErrorState,
  LoadingSpinner,
} from '@/app/components/dashboard'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function EnvironmentsPage() {
  const params = useParams()
  const owner = params.owner as string
  const repo = params.repo as string

  const [vault, setVault] = useState<Vault | null>(null)
  const [environments, setEnvironments] = useState<string[]>([])
  const [secrets, setSecrets] = useState<Secret[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [newEnvName, setNewEnvName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Rename state
  const [renamingEnv, setRenamingEnv] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Delete confirmation state
  const [deleteEnv, setDeleteEnv] = useState<string | null>(null)
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  // Count secrets per environment
  const secretsCountByEnv = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const secret of secrets) {
      counts[secret.environment] = (counts[secret.environment] || 0) + 1
    }
    return counts
  }, [secrets])

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [vaultData, envsData, secretsData] = await Promise.all([
        api.getVaultByRepo(owner, repo),
        api.getEnvironments(owner, repo),
        api.getSecretsByRepo(owner, repo),
      ])
      setVault(vaultData)
      setEnvironments(envsData)
      setSecrets(secretsData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load environments')
    } finally {
      setIsLoading(false)
    }
  }, [owner, repo])

  useEffect(() => {
    fetchData()
    trackEvent(AnalyticsEvents.ENVIRONMENT_VIEW)
  }, [fetchData])

  const handleAddEnvironment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newEnvName.trim()) return

    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const envName = newEnvName.toLowerCase().trim()
      const result = await api.createEnvironment(owner, repo, envName)
      setEnvironments(result.environments)
      setNewEnvName('')
      setIsAddModalOpen(false)
      trackEvent(AnalyticsEvents.ENVIRONMENT_CREATE, { environment: envName })
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create environment')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleStartRename = (env: string) => {
    setRenamingEnv(env)
    setRenameValue(env)
    setSubmitError(null)
  }

  const handleCancelRename = () => {
    setRenamingEnv(null)
    setRenameValue('')
    setSubmitError(null)
  }

  const handleRename = async (oldName: string) => {
    if (!renameValue.trim() || renameValue === oldName) {
      handleCancelRename()
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const newName = renameValue.toLowerCase().trim()
      const result = await api.renameEnvironment(owner, repo, oldName, newName)
      setEnvironments(result.environments)
      handleCancelRename()
      trackEvent(AnalyticsEvents.ENVIRONMENT_RENAME, { from: oldName, to: newName })
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to rename environment')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteClick = (envName: string) => {
    const secretCount = secretsCountByEnv[envName] || 0
    if (secretCount === 0) {
      // No secrets: use simple confirm
      if (confirm(`Are you sure you want to delete "${envName}"?`)) {
        performDelete(envName)
      }
    } else {
      // Has secrets: show scary modal
      setDeleteEnv(envName)
      setDeleteConfirmInput('')
    }
  }

  const performDelete = async (envName: string) => {
    setIsDeleting(true)
    try {
      const secretCount = secretsCountByEnv[envName] || 0
      const result = await api.deleteEnvironment(owner, repo, envName)
      setEnvironments(result.environments)
      setSecrets(prev => prev.filter(s => s.environment !== envName))
      setDeleteEnv(null)
      setDeleteConfirmInput('')
      trackEvent(AnalyticsEvents.ENVIRONMENT_DELETE, {
        environment: envName,
        secretsDeleted: secretCount,
      })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete environment')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleConfirmDelete = () => {
    if (deleteEnv && deleteConfirmInput === deleteEnv) {
      performDelete(deleteEnv)
    }
  }

  const closeDeleteModal = () => {
    setDeleteEnv(null)
    setDeleteConfirmInput('')
  }

  const isAdmin = vault?.permission === 'admin'

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-2">
          <Link
            href={`/vaults/${owner}/${repo}`}
            className="inline-flex items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground transition-colors py-2 pr-4"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
            </svg>
            Back to vault
          </Link>
        </div>

        <div className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">Environments</h1>
              <p className="text-foreground-muted text-sm mt-1">
                Manage environments for {owner}/{repo}
              </p>
            </div>
            {isAdmin && (
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="px-4 py-2 text-sm font-medium bg-primary text-dark rounded-lg hover:bg-primary-strong transition-colors flex items-center gap-2 cursor-pointer shrink-0 self-start"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Environment
              </button>
            )}
          </div>
        </div>

        {error ? (
          <ErrorState message={error} onRetry={fetchData} />
        ) : isLoading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        ) : (
          <div className="bg-card border border-card-border rounded-xl">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="font-semibold text-foreground">
                {environments.length} environment{environments.length !== 1 ? 's' : ''}
              </h2>
            </div>

            <div className="divide-y divide-border">
              {environments.map((env) => (
                <div key={env} className="px-4 py-3 flex items-center justify-between">
                  {renamingEnv === env ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        handleRename(env)
                      }}
                      className="flex-1 flex items-center gap-2"
                    >
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="flex-1 px-3 py-1.5 text-sm bg-background border border-card-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                        autoFocus
                        disabled={isSubmitting}
                      />
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className="px-3 py-1.5 text-sm font-medium bg-primary text-dark rounded-lg hover:bg-primary-strong transition-colors disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelRename}
                        className="px-3 py-1.5 text-sm text-foreground-muted hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <span className="px-2.5 py-1 text-sm font-medium bg-gray-100 dark:bg-gray-700 rounded-md text-foreground">
                          {env}
                        </span>
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleStartRename(env)}
                            className="p-2 text-foreground-muted hover:text-foreground transition-colors"
                            title="Rename environment"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDeleteClick(env)}
                            disabled={environments.length === 1}
                            className="p-2 text-foreground-muted hover:text-red-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            title={environments.length === 1 ? "Can't delete the last environment" : 'Delete environment'}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add Environment Modal */}
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-card border border-card-border rounded-xl w-full max-w-md p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">Add Environment</h3>
              <form onSubmit={handleAddEnvironment}>
                <div className="mb-4">
                  <label htmlFor="env-name" className="block text-sm font-medium text-foreground mb-1.5">
                    Environment name
                  </label>
                  <input
                    id="env-name"
                    type="text"
                    value={newEnvName}
                    onChange={(e) => setNewEnvName(e.target.value)}
                    placeholder="preview"
                    className="w-full px-3 py-2 bg-background border border-card-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                    autoFocus
                    disabled={isSubmitting}
                  />
                  <p className="mt-1.5 text-xs text-foreground-muted">
                    Lowercase letters, numbers, dashes, and underscores. 2-30 characters.
                  </p>
                </div>

                {submitError && (
                  <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                    {submitError}
                  </div>
                )}

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddModalOpen(false)
                      setNewEnvName('')
                      setSubmitError(null)
                    }}
                    className="px-4 py-2 text-sm text-foreground-muted hover:text-foreground transition-colors"
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !newEnvName.trim()}
                    className="px-4 py-2 text-sm font-medium bg-primary text-dark rounded-lg hover:bg-primary-strong transition-colors disabled:opacity-50"
                  >
                    {isSubmitting ? 'Creating...' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Dangerous Delete Confirmation Modal */}
        <AlertDialog open={deleteEnv !== null} onOpenChange={(open) => !open && closeDeleteModal()}>
          <AlertDialogContent className="sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                Delete Environment
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-4">
                  <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-destructive">
                    <p className="font-semibold">This action is irreversible!</p>
                    <p className="mt-1 text-sm">
                      You are about to permanently delete the <strong>{deleteEnv}</strong> environment
                      {deleteEnv && secretsCountByEnv[deleteEnv] && (
                        <> and its <strong>{secretsCountByEnv[deleteEnv]} secret{secretsCountByEnv[deleteEnv] > 1 ? 's' : ''}</strong></>
                      )}.
                    </p>
                    <p className="mt-2 text-sm">
                      This will break any application or service using these secrets.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-env-name" className="text-foreground">
                      Type <span className="font-mono font-bold">{deleteEnv}</span> to confirm
                    </Label>
                    <Input
                      id="confirm-env-name"
                      value={deleteConfirmInput}
                      onChange={(e) => setDeleteConfirmInput(e.target.value)}
                      placeholder={deleteEnv || ''}
                      className="font-mono"
                      autoComplete="off"
                      autoFocus
                    />
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={deleteConfirmInput !== deleteEnv || isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete Environment'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  )
}
