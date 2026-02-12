'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Plus, Upload, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Vault, ReadonlyReason, UserPlan } from '@/lib/types'

// Plan limits for contextual messages
const PLAN_LIMITS: Record<UserPlan, number> = {
  free: 1,
  pro: 5,
  team: 10,
  startup: 40,
}

// Get contextual read-only message based on reason and plan
function getReadonlyInfo(reason: ReadonlyReason, plan: UserPlan, repoOwner: string): {
  message: string
  linkText: string
  linkHref: string
} {
  if (reason === 'plan_limit_exceeded') {
    const limit = PLAN_LIMITS[plan]
    const nextPlan = plan === 'free' ? 'Pro' : plan === 'pro' ? 'Team' : plan === 'team' ? 'Startup' : null
    return {
      message: `You've exceeded your ${plan} plan limit of ${limit} private vault${limit === 1 ? '' : 's'}. Your oldest vaults remain writable.`,
      linkText: nextPlan ? `Upgrade to ${nextPlan}` : 'Manage subscription',
      linkHref: '/upgrade',
    }
  }
  if (reason === 'org_free_plan') {
    return {
      message: `This organization is on the Free plan. Upgrade the organization to unlock editing.`,
      linkText: 'Upgrade organization',
      linkHref: `/orgs/${repoOwner}/billing`,
    }
  }
  return {
    message: 'This vault is read-only.',
    linkText: 'Learn more',
    linkHref: '/upgrade',
  }
}

export interface VaultDetailHeaderProps {
  vault: Vault | undefined
  isLoading: boolean
  canWrite: boolean
  userPlan: UserPlan
  onAddSecret: () => void
  onBulkImport: () => void
}

export function VaultDetailHeader({
  vault,
  isLoading,
  canWrite,
  userPlan,
  onAddSecret,
  onBulkImport,
}: VaultDetailHeaderProps) {
  if (isLoading) {
    return <VaultDetailHeaderSkeleton />
  }

  if (!vault) {
    return null
  }

  return (
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
              <DropdownMenuItem onClick={onAddSecret}>
                <Plus className="w-4 h-4 mr-2" />
                Add single secret
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onBulkImport}>
                <Upload className="w-4 h-4 mr-2" />
                Import from .env
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Read-only banner for users who exceeded plan limits */}
      {vault.is_read_only && (() => {
        const readonlyInfo = getReadonlyInfo(vault.readonly_reason, userPlan, vault.repo_owner)
        return (
          <div className="mt-4 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-900/20">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span className="text-sm font-medium text-amber-800 dark:text-amber-400">
                Read-only vault
              </span>
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
              {readonlyInfo.message}{' '}
              <Link href={readonlyInfo.linkHref} className="underline hover:no-underline">
                {readonlyInfo.linkText}
              </Link>
            </p>
          </div>
        )
      })()}
    </>
  )
}

export function VaultDetailHeaderSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-32" />
    </div>
  )
}
