'use client'

import { useEffect, useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Copy,
  Check,
  AlertTriangle,
  Trash2,
  Clock,
  Shield,
  Eye,
  EyeOff,
  Loader2,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { ApiKey, ApiKeyScope, CreateApiKeyResponse } from '@/lib/types'
import {
  DashboardLayout,
  ErrorState,
  EmptyState,
} from '@/app/components/dashboard'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

const AVAILABLE_SCOPES: { id: ApiKeyScope; label: string; description: string }[] = [
  { id: 'read:secrets', label: 'Read Secrets', description: 'Pull secrets and list vaults' },
  { id: 'write:secrets', label: 'Write Secrets', description: 'Push secrets and create vaults' },
  { id: 'delete:secrets', label: 'Delete Secrets', description: 'Delete secrets and vaults' },
  { id: 'admin:api-keys', label: 'Manage API Keys', description: 'Create and revoke API keys' },
]

const EXPIRATION_OPTIONS = [
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '6 months' },
  { value: '365', label: '1 year' },
  { value: 'never', label: 'No expiration' },
]

function formatDate(dateString: string | null): string {
  if (!dateString) return 'Never'
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatRelativeDate(dateString: string | null): string {
  if (!dateString) return 'Never used'
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    if (diffHours === 0) {
      const diffMinutes = Math.floor(diffMs / (1000 * 60))
      return diffMinutes <= 1 ? 'Just now' : `${diffMinutes} minutes ago`
    }
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`
  }
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  return formatDate(dateString)
}

function ApiKeyCardSkeleton() {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-32" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-20" />
            </div>
          </div>
          <Skeleton className="h-9 w-20" />
        </div>
      </CardContent>
    </Card>
  )
}

function ApiKeyCard({
  apiKey,
  onRevoke,
}: {
  apiKey: ApiKey
  onRevoke: (id: string, name: string) => void
}) {
  const isExpired = apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()
  const isRevoked = !!apiKey.revokedAt

  return (
    <Card className={cn(
      (isRevoked || isExpired) && 'opacity-60'
    )}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-foreground truncate">{apiKey.name}</h3>
              {isRevoked && (
                <Badge variant="destructive" className="shrink-0">Revoked</Badge>
              )}
              {isExpired && !isRevoked && (
                <Badge variant="outline" className="text-amber-600 border-amber-600 shrink-0">
                  Expired
                </Badge>
              )}
            </div>

            <code className="text-sm text-muted-foreground font-mono">
              {apiKey.prefix}••••••••
            </code>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {formatRelativeDate(apiKey.lastUsedAt)}
              </span>
              <span>
                {apiKey.usageCount.toLocaleString()} request{apiKey.usageCount !== 1 ? 's' : ''}
              </span>
              {apiKey.expiresAt && (
                <span>
                  Expires {formatDate(apiKey.expiresAt)}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5 mt-3">
              {apiKey.scopes.map((scope) => (
                <Badge key={scope} variant="outline" className="text-xs font-normal">
                  {scope}
                </Badge>
              ))}
            </div>
          </div>

          {!isRevoked && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive shrink-0"
              onClick={() => onRevoke(apiKey.id, apiKey.name)}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function CreateApiKeyModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (key: CreateApiKeyResponse) => void
}) {
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<ApiKeyScope[]>(['read:secrets'])
  const [expiration, setExpiration] = useState('90')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleScopeToggle = (scope: ApiKeyScope) => {
    setScopes(prev =>
      prev.includes(scope)
        ? prev.filter(s => s !== scope)
        : [...prev, scope]
    )
  }

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (scopes.length === 0) {
      setError('Select at least one scope')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await api.createApiKey({
        name: name.trim(),
        environment: 'live',
        scopes,
        expiresInDays: expiration === 'never' ? undefined : parseInt(expiration),
      })
      onCreated(result)
      // Reset form
      setName('')
      setScopes(['read:secrets'])
      setExpiration('90')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create API Key</DialogTitle>
          <DialogDescription>
            Generate a new API key for programmatic access to Keyway.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="e.g., CI/CD Production"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Scopes</Label>
            <div className="space-y-3">
              {AVAILABLE_SCOPES.map((scope) => (
                <div key={scope.id} className="flex items-start gap-3">
                  <Checkbox
                    id={scope.id}
                    checked={scopes.includes(scope.id)}
                    onCheckedChange={() => handleScopeToggle(scope.id)}
                  />
                  <div className="grid gap-0.5 leading-none">
                    <label
                      htmlFor={scope.id}
                      className="text-sm font-medium cursor-pointer"
                    >
                      {scope.label}
                    </label>
                    <p className="text-xs text-muted-foreground">
                      {scope.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Expiration</Label>
            <Select value={expiration} onValueChange={setExpiration}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRATION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              'Create API Key'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TokenDisplayModal({
  token,
  open,
  onOpenChange,
}: {
  token: CreateApiKeyResponse | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [copied, setCopied] = useState(false)
  const [showToken, setShowToken] = useState(false)

  const handleCopy = async () => {
    if (!token) return
    await navigator.clipboard.writeText(token.token)
    setCopied(true)
    trackEvent(AnalyticsEvents.API_KEY_COPY)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check className="w-5 h-5 text-green-500" />
            API Key Created
          </DialogTitle>
          <DialogDescription>
            Copy your API key now. You won&apos;t be able to see it again!
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  Save this key securely
                </p>
                <p className="text-amber-700 dark:text-amber-300 mt-1">
                  This is the only time you&apos;ll see this key. Store it in a secure location.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Your API Key</Label>
            <div className="relative">
              <Input
                value={showToken ? (token?.token || '') : '•'.repeat(token?.token.length || 50)}
                readOnly
                className="font-mono text-sm pr-20"
              />
              <div className="absolute right-1 top-1 flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setShowToken(!showToken)}
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={handleCopy}
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>

          {token && (
            <div className="mt-4 p-3 bg-muted rounded-lg">
              <div className="space-y-1 text-sm">
                <div>
                  <span className="text-muted-foreground">Name:</span>{' '}
                  <span className="font-medium">{token.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Scopes:</span>{' '}
                  <span className="font-medium">{token.scopes.join(', ')}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} className="w-full">
            I&apos;ve saved my key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function ApiKeysPage() {
  const queryClient = useQueryClient()
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createdToken, setCreatedToken] = useState<CreateApiKeyResponse | null>(null)
  const [tokenModalOpen, setTokenModalOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null)
  const hasFiredView = useRef(false)

  // Fetch API keys with TanStack Query
  const {
    data: apiKeys = [],
    isLoading,
    error,
    refetch,
  } = useQuery<ApiKey[]>({
    queryKey: ['apiKeys'],
    queryFn: () => api.getApiKeys(),
  })

  // Mutation for revoking API keys
  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: (_, id) => {
      trackEvent(AnalyticsEvents.API_KEY_REVOKE)
      // Optimistically update the cache
      queryClient.setQueryData<ApiKey[]>(['apiKeys'], (old) =>
        old?.map((k) =>
          k.id === id
            ? { ...k, revokedAt: new Date().toISOString(), isActive: false }
            : k
        )
      )
      setRevokeTarget(null)
    },
    onError: (err) => {
      console.error('Failed to revoke API key:', err)
    },
  })

  useEffect(() => {
    if (!hasFiredView.current) {
      hasFiredView.current = true
      trackEvent(AnalyticsEvents.API_KEYS_VIEW)
    }
  }, [])

  const handleCreated = (key: CreateApiKeyResponse) => {
    setCreateModalOpen(false)
    setCreatedToken(key)
    setTokenModalOpen(true)
    // Track creation
    trackEvent(AnalyticsEvents.API_KEY_CREATE, {
      environment: key.environment,
      scopes: key.scopes,
    })
    // Add the new key to the cache
    queryClient.setQueryData<ApiKey[]>(['apiKeys'], (old) => [
      {
        ...key,
        token: undefined as never,
      } as ApiKey,
      ...(old || []),
    ])
  }

  const handleRevoke = () => {
    if (!revokeTarget) return
    revokeMutation.mutate(revokeTarget.id)
  }

  const activeKeys = apiKeys.filter((k) => k.isActive)
  const inactiveKeys = apiKeys.filter((k) => !k.isActive)

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold mb-1 text-foreground">API Keys</h2>
            <p className="text-muted-foreground">Manage programmatic access to Keyway</p>
          </div>
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Key
          </Button>
        </div>

        {/* Info banner */}
        <Card className="mb-6 bg-muted/50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-foreground">Secure API Access</p>
                <p className="text-muted-foreground mt-1">
                  API keys allow programmatic access to your secrets. Use them in CI/CD pipelines,
                  scripts, or applications. Keys are hashed and never stored in plain text.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {error ? (
          <ErrorState message={error instanceof Error ? error.message : 'Failed to load API keys'} onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <ApiKeyCardSkeleton key={i} />
            ))}
          </div>
        ) : apiKeys.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <EmptyState
                title="No API keys yet"
                message="Create an API key to access Keyway programmatically"
                action={
                  <Button onClick={() => setCreateModalOpen(true)} className="mt-4">
                    <Plus className="w-4 h-4 mr-2" />
                    Create your first API key
                  </Button>
                }
              />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Active keys */}
            {activeKeys.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">
                  Active Keys ({activeKeys.length})
                </h3>
                {activeKeys.map((key) => (
                  <ApiKeyCard
                    key={key.id}
                    apiKey={key}
                    onRevoke={(id, name) => setRevokeTarget({ id, name })}
                  />
                ))}
              </div>
            )}

            {/* Inactive keys */}
            {inactiveKeys.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">
                  Inactive Keys ({inactiveKeys.length})
                </h3>
                {inactiveKeys.map((key) => (
                  <ApiKeyCard
                    key={key.id}
                    apiKey={key}
                    onRevoke={(id, name) => setRevokeTarget({ id, name })}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Create modal */}
        <CreateApiKeyModal
          open={createModalOpen}
          onOpenChange={setCreateModalOpen}
          onCreated={handleCreated}
        />

        {/* Token display modal */}
        <TokenDisplayModal
          token={createdToken}
          open={tokenModalOpen}
          onOpenChange={setTokenModalOpen}
        />

        {/* Revoke confirmation */}
        <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to revoke <strong>{revokeTarget?.name}</strong>? This action
                cannot be undone and any applications using this key will stop working immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={revokeMutation.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleRevoke}
                disabled={revokeMutation.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {revokeMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Revoking...
                  </>
                ) : (
                  'Revoke Key'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  )
}
