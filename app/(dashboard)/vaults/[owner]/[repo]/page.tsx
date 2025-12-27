'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import Image from 'next/image'
import { ChevronLeft, Plus, Upload, Search, X, Settings, Users, RefreshCw, ExternalLink, AlertTriangle, Copy } from 'lucide-react'
import { api } from '@/lib/api'
import type { Vault, Secret, TrashedSecret, VaultPermission } from '@/lib/types'
import {
  DashboardLayout,
  SecretRow,
  SecretRowSkeleton,
  SecretModal,
  ViewSecretModal,
  BulkImportModal,
  ErrorState,
  EmptyState,
  TrashSection,
  SyncButton,
} from '@/app/components/dashboard'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { getEnvironmentColor } from '@/lib/environment-colors'

// GitHub role config with Keyway-specific descriptions
const permissionConfig: Record<VaultPermission, {
  label: string
  color: string
  bgColor: string
  description: string
  canWrite: boolean
}> = {
  admin: {
    label: 'Admin',
    color: 'text-amber-400',
    bgColor: 'bg-amber-400/10',
    description: 'Full access to this repository on GitHub. Can manage secrets and vault settings.',
    canWrite: true,
  },
  maintain: {
    label: 'Maintain',
    color: 'text-purple-400',
    bgColor: 'bg-purple-400/10',
    description: 'Maintainer access on GitHub. Can manage secrets but not vault settings.',
    canWrite: true,
  },
  write: {
    label: 'Write',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-400/10',
    description: 'Write access on GitHub. Can create, edit and delete secrets.',
    canWrite: true,
  },
  triage: {
    label: 'Triage',
    color: 'text-blue-400',
    bgColor: 'bg-blue-400/10',
    description: 'Triage access on GitHub. Can view secrets metadata only.',
    canWrite: false,
  },
  read: {
    label: 'Read',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
    description: 'Read access on GitHub. Can view secrets metadata only.',
    canWrite: false,
  },
}

// Provider display config
const providerConfig: Record<string, { label: string; icon: string; color: string; url?: string }> = {
  vercel: { label: 'Vercel', icon: '▲', color: 'text-foreground', url: 'https://vercel.com' },
  railway: { label: 'Railway', icon: '🚂', color: 'text-foreground', url: 'https://railway.app' },
  netlify: { label: 'Netlify', icon: '◆', color: 'text-teal-500', url: 'https://netlify.com' },
  fly: { label: 'Fly.io', icon: '✈', color: 'text-purple-500', url: 'https://fly.io' },
}

function formatLastSynced(dateString: string | null): string {
  if (!dateString) return 'Never synced'
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) return 'Just now'
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`
  return date.toLocaleDateString()
}

export default function VaultDetailPage() {
  const params = useParams()
  const owner = params.owner as string
  const repo = params.repo as string
  const queryClient = useQueryClient()

  // UI state (not data)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false)
  const [editingSecret, setEditingSecret] = useState<Secret | null>(null)
  const [viewingSecret, setViewingSecret] = useState<Secret | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEnvironment, setSelectedEnvironment] = useState<string>('all')
  const [showAllIncomplete, setShowAllIncomplete] = useState(false)
  const hasFiredView = useRef(false)

  // Fetch vault data with TanStack Query
  const {
    data: vault,
    isLoading: vaultLoading,
    error: vaultError,
  } = useQuery<Vault>({
    queryKey: ['vault', owner, repo],
    queryFn: () => api.getVaultByRepo(owner, repo),
  })

  // Fetch secrets with TanStack Query
  const {
    data: secrets = [],
    isLoading: secretsLoading,
    error: secretsError,
    refetch: refetchSecrets,
  } = useQuery<Secret[]>({
    queryKey: ['secrets', owner, repo],
    queryFn: () => api.getSecretsByRepo(owner, repo),
  })

  // Fetch trashed secrets with TanStack Query
  const {
    data: trashedSecrets = [],
    isLoading: trashLoading,
  } = useQuery<TrashedSecret[]>({
    queryKey: ['trash', owner, repo],
    queryFn: () => api.getTrashedSecrets(owner, repo),
  })

  const isLoading = vaultLoading || secretsLoading || trashLoading
  const error = vaultError || secretsError

  // Helper to refetch all data
  const refetchAll = () => {
    queryClient.invalidateQueries({ queryKey: ['vault', owner, repo] })
    queryClient.invalidateQueries({ queryKey: ['secrets', owner, repo] })
    queryClient.invalidateQueries({ queryKey: ['trash', owner, repo] })
  }

  useEffect(() => {
    if (!hasFiredView.current) {
      hasFiredView.current = true
      trackEvent(AnalyticsEvents.VAULT_DETAIL_VIEW, {
        repoName: `${owner}/${repo}`,
      })
    }
  }, [owner, repo])

  // Track search with debounce
  useEffect(() => {
    if (!searchQuery) return
    const timeout = setTimeout(() => {
      trackEvent(AnalyticsEvents.VAULT_SEARCH, {
        repo: `${owner}/${repo}`,
        query: searchQuery,
        resultsCount: secrets.filter(s =>
          s.name.toLowerCase().includes(searchQuery.toLowerCase())
        ).length,
      })
    }, 500)
    return () => clearTimeout(timeout)
  }, [searchQuery, owner, repo, secrets])

  const handleEnvironmentFilter = (env: string) => {
    const newEnv = env === selectedEnvironment ? 'all' : env
    setSelectedEnvironment(newEnv)
    if (newEnv !== 'all') {
      trackEvent(AnalyticsEvents.ENVIRONMENT_FILTER, {
        repo: `${owner}/${repo}`,
        environment: newEnv,
      })
    }
  }

  const handleCreateSecret = () => {
    setEditingSecret(null)
    setIsModalOpen(true)
    trackEvent(AnalyticsEvents.SECRET_MODAL_OPEN, { action: 'create' })
  }

  const handleBulkImport = () => {
    setIsBulkImportOpen(true)
    trackEvent(AnalyticsEvents.SECRET_MODAL_OPEN, { action: 'bulk_import' })
  }

  const handleViewSecret = (secret: Secret) => {
    setViewingSecret(secret)
    trackEvent(AnalyticsEvents.SECRET_MODAL_OPEN, { action: 'view', secretName: secret.name })
  }

  const handleEditSecret = (secret: Secret) => {
    setEditingSecret(secret)
    setIsModalOpen(true)
    trackEvent(AnalyticsEvents.SECRET_MODAL_OPEN, { action: 'edit', secretName: secret.name })
  }

  const handleDeleteSecret = async (secret: Secret) => {
    // Optimistically remove from UI
    queryClient.setQueryData<Secret[]>(['secrets', owner, repo], (old) =>
      old?.filter((s) => s.id !== secret.id)
    )

    try {
      const result = await api.deleteSecretByRepo(owner, repo, secret.id)
      trackEvent(AnalyticsEvents.SECRET_DELETE, { secretName: secret.name })

      // Add to trash cache
      queryClient.setQueryData<TrashedSecret[]>(['trash', owner, repo], (old) => [
        {
          id: secret.id,
          name: secret.name,
          environment: secret.environment,
          deleted_at: result.deletedAt,
          expires_at: result.expiresAt,
          days_remaining: 30,
        },
        ...(old || []),
      ])

      // Toast with undo button
      toast.success(`"${secret.name}" moved to trash`, {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              const restored = await api.restoreSecret(owner, repo, secret.id)
              queryClient.setQueryData<Secret[]>(['secrets', owner, repo], (old) => [...(old || []), restored])
              queryClient.setQueryData<TrashedSecret[]>(['trash', owner, repo], (old) =>
                old?.filter((s) => s.id !== secret.id)
              )
              toast.success(`"${secret.name}" restored`)
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Failed to restore secret')
            }
          },
        },
        duration: 8000,
      })
    } catch (err) {
      // Revert optimistic update
      queryClient.setQueryData<Secret[]>(['secrets', owner, repo], (old) => [...(old || []), secret])
      toast.error(err instanceof Error ? err.message : 'Failed to delete secret')
    }
  }

  const handleSubmitSecret = async (data: { name: string; value: string; environments: string[] }) => {
    setIsSubmitting(true)
    try {
      if (editingSecret) {
        // Update: only update the single secret (environments array will have 1 item)
        const updated = await api.updateSecretByRepo(owner, repo, editingSecret.id, {
          name: data.name,
          value: data.value || undefined,
        })
        queryClient.setQueryData<Secret[]>(['secrets', owner, repo], (old) =>
          old?.map((s) => (s.id === editingSecret.id ? updated : s))
        )
        trackEvent(AnalyticsEvents.SECRET_EDIT, { secretName: data.name })
        toast.success(`Secret "${data.name}" updated`)
      } else {
        // Create: create one secret per selected environment
        const created = await Promise.all(
          data.environments.map((env) =>
            api.createSecretByRepo(owner, repo, {
              name: data.name,
              value: data.value,
              environment: env,
            })
          )
        )
        queryClient.setQueryData<Secret[]>(['secrets', owner, repo], (old) => [...(old || []), ...created])

        // Add new environments to vault if they don't exist
        const newEnvs = data.environments.filter(
          (env) => vault && !vault.environments.includes(env)
        )
        if (vault && newEnvs.length > 0) {
          queryClient.setQueryData<Vault>(['vault', owner, repo], (old) =>
            old ? { ...old, environments: [...old.environments, ...newEnvs] } : old
          )
        }

        trackEvent(AnalyticsEvents.SECRET_CREATE, {
          secretName: data.name,
          environments: data.environments,
          count: data.environments.length,
        })

        const envCount = data.environments.length
        toast.success(
          envCount === 1
            ? `Secret "${data.name}" created`
            : `Secret "${data.name}" created in ${envCount} environments`
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save secret')
      throw err
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleBulkImportSubmit = async (secretsToImport: { name: string; value: string; environment: string }[]) => {
    // Create secrets one by one
    const createdSecrets: Secret[] = []
    const newEnvironments = new Set<string>()

    for (const secretData of secretsToImport) {
      const created = await api.createSecretByRepo(owner, repo, secretData)
      createdSecrets.push(created)
      if (vault && !vault.environments.includes(secretData.environment)) {
        newEnvironments.add(secretData.environment)
      }
    }

    queryClient.setQueryData<Secret[]>(['secrets', owner, repo], (old) => [...(old || []), ...createdSecrets])

    // Update vault environments if new ones were added
    if (vault && newEnvironments.size > 0) {
      queryClient.setQueryData<Vault>(['vault', owner, repo], (old) =>
        old ? { ...old, environments: [...old.environments, ...Array.from(newEnvironments)] } : old
      )
    }

    trackEvent(AnalyticsEvents.SECRET_CREATE, {
      action: 'bulk_import',
      count: createdSecrets.length,
    })

    toast.success(`Imported ${createdSecrets.length} secret${createdSecrets.length !== 1 ? 's' : ''}`)
  }

  // Get unique environments from vault config + actual secrets
  // We prioritize vault.environments order, then add any extra from secrets
  const allEnvironments = vault
    ? Array.from(new Set([...vault.environments, ...secrets.map((s) => s.environment)]))
    : []

  // Count secrets per environment
  const secretsByEnv = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const env of allEnvironments) {
      counts[env] = secrets.filter(s => s.environment === env).length
    }
    return counts
  }, [secrets, allEnvironments])

  // Group secrets by name to find coverage
  const secretsByName = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const secret of secrets) {
      if (!map.has(secret.name)) map.set(secret.name, new Set())
      map.get(secret.name)!.add(secret.environment)
    }
    return map
  }, [secrets])

  // Find incomplete secrets (not in all environments)
  const incompleteSecrets = useMemo(() => {
    // Compare against ALL environments (not just active ones)
    // This allows copying secrets to empty environments
    if (allEnvironments.length <= 1) return []

    const result: { name: string; missingIn: string[] }[] = []
    Array.from(secretsByName.entries()).forEach(([name, envs]) => {
      const missing = allEnvironments.filter(env => !envs.has(env))
      if (missing.length > 0 && missing.length < allEnvironments.length) {
        // Only show if partially present (not missing everywhere)
        result.push({ name, missingIn: missing })
      }
    })
    return result.sort((a, b) => b.missingIn.length - a.missingIn.length)
  }, [secretsByName, allEnvironments])

  // Get existing secret names for duplicate detection
  const existingSecretNames = secrets.map(s => s.name)

  // Handle restoring a secret from trash
  const handleRestoreSecret = async (trashedSecret: TrashedSecret) => {
    try {
      const restored = await api.restoreSecret(owner, repo, trashedSecret.id)
      queryClient.setQueryData<Secret[]>(['secrets', owner, repo], (old) => [...(old || []), restored])
      queryClient.setQueryData<TrashedSecret[]>(['trash', owner, repo], (old) =>
        old?.filter((s) => s.id !== trashedSecret.id)
      )
      toast.success(`"${trashedSecret.name}" restored`)
      trackEvent(AnalyticsEvents.SECRET_CREATE, { secretName: trashedSecret.name, action: 'restore' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to restore secret')
    }
  }

  // Handle permanently deleting a secret from trash
  const handlePermanentDelete = async (trashedSecret: TrashedSecret) => {
    try {
      await api.permanentlyDeleteSecret(owner, repo, trashedSecret.id)
      queryClient.setQueryData<TrashedSecret[]>(['trash', owner, repo], (old) =>
        old?.filter((s) => s.id !== trashedSecret.id)
      )
      toast.success(`"${trashedSecret.name}" permanently deleted`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete secret')
    }
  }

  // Handle emptying the entire trash
  const handleEmptyTrash = async () => {
    try {
      const { deleted } = await api.emptyTrash(owner, repo)
      queryClient.setQueryData<TrashedSecret[]>(['trash', owner, repo], () => [])
      toast.success(`Permanently deleted ${deleted} secret${deleted !== 1 ? 's' : ''}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to empty trash')
    }
  }

  // Handle copying a secret to a single environment
  const handleCopyToEnv = async (secretName: string, targetEnv: string) => {
    const sourceSecret = secrets.find(s => s.name === secretName)
    if (!sourceSecret) return

    try {
      const { value } = await api.getSecretValue(owner, repo, sourceSecret.id)
      const created = await api.createSecretByRepo(owner, repo, {
        name: secretName,
        value,
        environment: targetEnv,
      })

      queryClient.setQueryData<Secret[]>(['secrets', owner, repo], (old) => [...(old || []), created])

      if (vault && !vault.environments.includes(targetEnv)) {
        queryClient.setQueryData<Vault>(['vault', owner, repo], (old) =>
          old ? { ...old, environments: [...old.environments, targetEnv] } : old
        )
      }

      toast.success(`Copied "${secretName}" to ${targetEnv}`)
      trackEvent(AnalyticsEvents.SECRET_COPY_TO_ENV, {
        secretName,
        fromEnv: sourceSecret.environment,
        toEnv: targetEnv,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to copy secret')
    }
  }

  // Determine if user can write to this vault (GitHub permission + not read-only due to plan)
  const canWrite = vault && permissionConfig[vault.permission].canWrite && !vault.is_read_only

  // Filter secrets based on search and environment
  const filteredSecrets = secrets.filter(secret => {
    const matchesSearch = searchQuery === '' ||
      secret.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesEnvironment = selectedEnvironment === 'all' ||
      secret.environment === selectedEnvironment
    return matchesSearch && matchesEnvironment
  })

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors py-2 pr-4"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to vaults
          </Link>
        </div>

        <div className="mb-6">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : vault ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Image
                    src={vault.repo_avatar}
                    alt={vault.repo_owner}
                    width={48}
                    height={48}
                    className="rounded-lg border border-border shrink-0"
                  />
                  <div className="min-w-0">
                    <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-foreground truncate">
                      {vault.repo_owner}/{vault.repo_name}
                    </h2>
                    <p className="text-muted-foreground text-sm">
                      {vault.secrets_count} secrets · {vault.environments.length} environments
                    </p>
                  </div>
                </div>
                {canWrite && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button className="shrink-0 self-start">
                        <Plus className="w-4 h-4 mr-2" />
                        Add Secrets
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={handleCreateSecret}>
                        <Plus className="w-4 h-4 mr-2" />
                        Add single secret
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleBulkImport}>
                        <Upload className="w-4 h-4 mr-2" />
                        Import from .env
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              {/* Read-only banner for downgraded users */}
              {vault.is_read_only && (
                <div className="mt-4 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-900/20">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-amber-800 dark:text-amber-400">
                      Read-only vault
                    </span>
                  </div>
                  <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
                    This vault is read-only on the Free plan. <Link href="/settings" className="underline hover:no-underline">Upgrade to Pro</Link> to edit secrets.
                  </p>
                </div>
              )}

              {/* Permission badge */}
              <div className={`mt-4 p-3 rounded-lg border border-border ${permissionConfig[vault.permission].bgColor}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${permissionConfig[vault.permission].color}`}>
                        {permissionConfig[vault.permission].label}
                      </span>
                      <span className="text-xs text-muted-foreground">on GitHub</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {permissionConfig[vault.permission].description}
                    </p>
                  </div>
                  {vault.permission === 'admin' && (
                    <Button variant="ghost" size="sm" asChild className="shrink-0">
                      <Link href={`/vaults/${owner}/${repo}/collaborators`}>
                        <Users className="w-4 h-4 mr-1.5" />
                        Collaborators
                      </Link>
                    </Button>
                  )}
                </div>
              </div>

              {/* Integrations section */}
              {vault.syncs && vault.syncs.length > 0 && (
                <div className="mt-4 p-3 rounded-lg border border-border bg-card">
                  <div className="flex items-center gap-2 mb-3">
                    <RefreshCw className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Synced Providers</span>
                  </div>
                  <div className="space-y-2">
                    {vault.syncs.map((sync) => {
                      const config = providerConfig[sync.provider] || {
                        label: sync.provider,
                        icon: '⚡',
                        color: 'text-muted-foreground',
                      }
                      return (
                        <div
                          key={sync.id}
                          className="flex items-center justify-between p-2 rounded-md bg-muted/30"
                        >
                          <div className="flex items-center gap-2">
                            <span className={`text-base ${config.color}`}>{config.icon}</span>
                            <div>
                              <span className="text-sm font-medium">{config.label}</span>
                              {sync.project_name && (
                                <span className="text-xs text-muted-foreground ml-2">
                                  {sync.project_name}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {formatLastSynced(sync.last_synced_at)}
                            </span>
                            <SyncButton
                              sync={sync}
                              owner={owner}
                              repo={repo}
                              providerLabel={config.label}
                              onSyncComplete={refetchAll}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {error ? (
          <ErrorState message={error instanceof Error ? error.message : 'Failed to load vault'} onRetry={refetchAll} />
        ) : (
          <>
            {/* Coverage warning */}
            {vault && incompleteSecrets.length > 0 && (
              <div className="mb-6">
                <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-900/20">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    <span className="text-sm font-medium text-amber-800 dark:text-amber-400">
                      {incompleteSecrets.length} secret{incompleteSecrets.length !== 1 ? 's' : ''} missing in some environments
                    </span>
                  </div>
                  <div className="space-y-2">
                    {(showAllIncomplete ? incompleteSecrets : incompleteSecrets.slice(0, 5)).map(({ name, missingIn }) => (
                      <div key={name} className="flex items-center justify-between text-sm gap-2">
                        <code className="font-mono text-amber-900 dark:text-amber-300 truncate">{name}</code>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-amber-700 dark:text-amber-500 text-xs">
                            missing in: {missingIn.join(', ')}
                          </span>
                          {canWrite && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
                                >
                                  <Copy className="w-3 h-3 mr-1" />
                                  Copy to...
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {missingIn.map(env => (
                                  <DropdownMenuItem key={env} onClick={() => handleCopyToEnv(name, env)}>
                                    {env}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </div>
                    ))}
                    {incompleteSecrets.length > 5 && (
                      <button
                        type="button"
                        onClick={() => setShowAllIncomplete(!showAllIncomplete)}
                        className="text-xs text-amber-600 dark:text-amber-500 hover:text-amber-800 dark:hover:text-amber-300 hover:underline transition-colors"
                      >
                        {showAllIncomplete ? 'Show less' : `+${incompleteSecrets.length - 5} more...`}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Environments section - stats cards */}
            {vault && allEnvironments.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Environments</h3>
                  {vault.permission === 'admin' && (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/vaults/${owner}/${repo}/environments`}>
                        <Settings className="w-4 h-4 mr-1.5" />
                        Manage
                      </Link>
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleEnvironmentFilter('all')}
                    className={`
                      px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border text-left transition-all
                      ${selectedEnvironment === 'all'
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border bg-card hover:border-muted-foreground/50'
                      }
                    `}
                  >
                    <div className="text-sm font-medium">All</div>
                    <div className="text-xs text-muted-foreground">
                      {secrets.length} secret{secrets.length !== 1 ? 's' : ''}
                    </div>
                  </button>
                  {allEnvironments.map((env) => {
                    const colors = getEnvironmentColor(env)
                    const isSelected = selectedEnvironment === env
                    return (
                      <button
                        key={env}
                        onClick={() => handleEnvironmentFilter(env)}
                        className={`
                          group relative px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border text-left transition-all
                          ${colors.border} ${colors.bg}
                          ${isSelected ? 'ring-2 ring-current/30' : 'opacity-60 hover:opacity-100'}
                          ${secretsByEnv[env] === 0 && !isSelected ? 'opacity-40' : ''}
                        `}
                      >
                        {isSelected && (
                          <X className="absolute -top-1.5 -right-1.5 w-4 h-4 p-0.5 rounded-full bg-muted-foreground text-background opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                        <div className={`text-sm font-medium ${colors.text}`}>{env}</div>
                        <div className="text-xs text-muted-foreground">
                          {secretsByEnv[env]} secret{secretsByEnv[env] !== 1 ? 's' : ''}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Secrets section */}
            <Card>
              <CardHeader className="py-3 space-y-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Secrets</CardTitle>
                  {!isLoading && secrets.length > 0 && (
                    <span className="text-sm text-muted-foreground">
                      {filteredSecrets.length} of {secrets.length}
                    </span>
                  )}
                </div>

                {/* Search - only show when there are secrets */}
                {!isLoading && secrets.length > 0 && (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Search secrets..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 pr-9"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}
              </CardHeader>

              <CardContent className="pt-0">
                {isLoading ? (
                  <>
                    {[...Array(5)].map((_, i) => (
                      <SecretRowSkeleton key={i} />
                    ))}
                  </>
                ) : secrets.length === 0 ? (
                  <div className="py-8">
                    <EmptyState
                      title="No secrets"
                      message="Add your first secret to this vault"
                      action={
                        canWrite ? (
                          <div className="flex gap-2">
                            <Button onClick={handleCreateSecret}>
                              Add Secret
                            </Button>
                            <Button variant="outline" onClick={handleBulkImport}>
                              <Upload className="w-4 h-4 mr-2" />
                              Import .env
                            </Button>
                          </div>
                        ) : undefined
                      }
                    />
                  </div>
                ) : filteredSecrets.length === 0 ? (
                  <div className="py-8">
                    <EmptyState
                      title="No matches"
                      message={`No secrets found${searchQuery ? ` matching "${searchQuery}"` : ''}${selectedEnvironment !== 'all' ? ` in ${selectedEnvironment}` : ''}`}
                      action={
                        <Button
                          variant="outline"
                          onClick={() => {
                            setSearchQuery('')
                            setSelectedEnvironment('all')
                          }}
                        >
                          Clear filters
                        </Button>
                      }
                    />
                  </div>
                ) : (
                  filteredSecrets.map((secret) => (
                    <SecretRow
                      key={secret.id}
                      secret={secret}
                      onView={handleViewSecret}
                      onEdit={canWrite ? handleEditSecret : undefined}
                      onDelete={canWrite ? handleDeleteSecret : undefined}
                    />
                  ))
                )}
              </CardContent>
            </Card>

            {/* Trash section */}
            <TrashSection
              trashedSecrets={trashedSecrets}
              onRestore={handleRestoreSecret}
              onPermanentDelete={handlePermanentDelete}
              onEmptyTrash={handleEmptyTrash}
              canWrite={!!canWrite}
            />
          </>
        )}

        <SecretModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSubmit={handleSubmitSecret}
          secret={editingSecret}
          environments={allEnvironments}
          isLoading={isSubmitting}
        />

        <BulkImportModal
          isOpen={isBulkImportOpen}
          onClose={() => setIsBulkImportOpen(false)}
          onImport={handleBulkImportSubmit}
          environments={allEnvironments}
          existingSecretNames={existingSecretNames}
        />

        <ViewSecretModal
          isOpen={!!viewingSecret}
          onClose={() => setViewingSecret(null)}
          secret={viewingSecret}
          owner={owner}
          repo={repo}
          canWrite={!!canWrite}
          onSecretUpdated={refetchAll}
        />
      </div>
    </DashboardLayout>
  )
}
