import Link from 'next/link'
import Image from 'next/image'
import { Trash2, MoreVertical, RefreshCw } from 'lucide-react'
import type { Vault } from '@/lib/types'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// Provider display config
const providerConfig: Record<string, { label: string; icon: string }> = {
  vercel: { label: 'Vercel', icon: '▲' },
  railway: { label: 'Railway', icon: '🚂' },
  netlify: { label: 'Netlify', icon: '◆' },
  fly: { label: 'Fly.io', icon: '✈' },
}

interface VaultCardProps {
  vault: Vault
  onDelete?: (vault: Vault) => void
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) return 'just now'
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`
  return date.toLocaleDateString()
}

// Check if vault has any warnings (e.g., missing production secrets)
function getVaultWarning(vault: Vault): string | null {
  // Check if vault has production environment but no secrets in it
  const hasProdEnv = vault.environments.some(env =>
    env.toLowerCase().includes('prod') || env.toLowerCase().includes('production')
  )

  // If there are syncs configured but one is stale (not synced in 7 days)
  if (vault.syncs && vault.syncs.length > 0) {
    const staleSyncs = vault.syncs.filter(sync => {
      if (!sync.last_synced_at) return true
      const lastSync = new Date(sync.last_synced_at)
      const daysSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60 * 24)
      return daysSinceSync > 7
    })
    if (staleSyncs.length > 0) {
      return 'Sync stale'
    }
  }

  // Placeholder for future warnings - could check API for coverage data
  if (vault.is_read_only) {
    return 'Read-only vault'
  }

  return null
}

export function VaultCard({ vault, onDelete }: VaultCardProps) {
  const effectivePermission = vault.permission || 'read'
  const canDelete = effectivePermission === 'admin'
  const warning = getVaultWarning(vault)
  const hasSyncs = vault.syncs && vault.syncs.length > 0

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onDelete?.(vault)
  }

  // Get sync provider info for display
  const syncInfo = vault.syncs?.[0]
  const syncProvider = syncInfo ? providerConfig[syncInfo.provider] : null

  return (
    <Link
      href={`/vaults/${vault.repo_owner}/${vault.repo_name}`}
      className="block group"
      onClick={() => trackEvent(AnalyticsEvents.VAULT_CARD_CLICK, {
        vaultId: vault.id,
        repoName: `${vault.repo_owner}/${vault.repo_name}`,
      })}
    >
      <Card className="p-4 hover:ring-2 hover:ring-ring/20 transition-all relative">
        {/* Warning indicator dot */}
        {warning && (
          <div
            className="absolute top-3 right-3 size-2 rounded-full bg-amber-500"
            title={warning}
          />
        )}

        {/* Header: Avatar + Name + Subtitle */}
        <div className="flex items-start gap-3">
          <Image
            src={vault.repo_avatar}
            alt={vault.repo_owner}
            width={40}
            height={40}
            className="rounded-lg ring-1 ring-border shrink-0"
          />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
              {vault.repo_owner}/{vault.repo_name}
            </h3>
            <p className="text-sm text-muted-foreground truncate">
              {warning ? (
                <span className="text-amber-500">{warning}</span>
              ) : syncInfo ? (
                `Syncing to ${syncProvider?.label || syncInfo.provider}`
              ) : (
                `Updated ${formatTimeAgo(vault.updated_at)}`
              )}
            </p>
          </div>
          {canDelete && onDelete && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.preventDefault()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreVertical className="h-4 w-4" />
                  <span className="sr-only">Vault actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={handleDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete vault
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-px mt-4 rounded-lg overflow-hidden border border-border">
          <div className="bg-muted/30 p-3">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Secrets
            </div>
            <div className="text-xl font-semibold text-foreground">
              {vault.secrets_count}
            </div>
          </div>
          <div className="bg-muted/30 p-3 border-l border-border">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Envs
            </div>
            <div className="text-xl font-semibold text-foreground">
              {vault.environments.length}
            </div>
          </div>
        </div>

        {/* Footer: Badge + Updated by */}
        <div className="flex items-center gap-2 mt-4">
          {hasSyncs && (
            <Badge
              variant="outline"
              className="text-xs text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
            >
              <RefreshCw className="size-3 mr-1" />
              Active
            </Badge>
          )}
          {vault.last_modified_by && (
            <span className="text-xs text-muted-foreground">
              Updated by {vault.last_modified_by}
            </span>
          )}
        </div>
      </Card>
    </Link>
  )
}

export function VaultCardSkeleton() {
  return (
    <Card className="p-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Skeleton className="size-10 rounded-lg" />
        <div className="flex-1">
          <Skeleton className="h-5 w-40 mb-2" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-px mt-4 rounded-lg overflow-hidden border border-border">
        <div className="bg-muted/30 p-3">
          <Skeleton className="h-3 w-12 mb-2" />
          <Skeleton className="h-6 w-8" />
        </div>
        <div className="bg-muted/30 p-3 border-l border-border">
          <Skeleton className="h-3 w-10 mb-2" />
          <Skeleton className="h-6 w-6" />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 mt-4">
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
    </Card>
  )
}
