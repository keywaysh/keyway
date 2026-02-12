'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Image from 'next/image'
import Link from 'next/link'
import { User, Building2, AlertTriangle } from 'lucide-react'
import { api } from '@/lib/api'
import type { Vault, UserPlan } from '@/lib/types'
import {
  DashboardLayout,
  VaultCard,
  VaultCardSkeleton,
  ErrorState,
  DeleteVaultModal,
  GitHubAppNotInstalledState,
  CreateVaultCard,
} from '@/app/components/dashboard'
import { CLICommand } from '@/app/components/cli-command'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import { useAuth } from '@/lib/auth'

interface VaultGroup {
  owner: string
  avatar: string
  vaults: Vault[]
  isPersonal: boolean
}

// Plan limits for display
const PLAN_LIMITS: Record<UserPlan, number> = {
  free: 1,
  pro: 5,
  team: 10,
  startup: 40,
}

function groupVaultsByOwner(vaults: Vault[], currentUsername?: string): VaultGroup[] {
  const groups = new Map<string, VaultGroup>()

  for (const vault of vaults) {
    const existing = groups.get(vault.repo_owner)
    if (existing) {
      existing.vaults.push(vault)
    } else {
      groups.set(vault.repo_owner, {
        owner: vault.repo_owner,
        avatar: vault.repo_avatar,
        vaults: [vault],
        isPersonal: vault.repo_owner === currentUsername,
      })
    }
  }

  // Sort: personal vaults first, then alphabetically by owner name
  return Array.from(groups.values()).sort((a, b) => {
    if (a.isPersonal && !b.isPersonal) return -1
    if (!a.isPersonal && b.isPersonal) return 1
    return a.owner.toLowerCase().localeCompare(b.owner.toLowerCase())
  })
}

export default function DashboardPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [vaultToDelete, setVaultToDelete] = useState<Vault | null>(null)
  const hasFiredView = useRef(false)

  const {
    data: vaults = [],
    isLoading,
    error,
    refetch,
  } = useQuery<Vault[], Error>({
    queryKey: ['vaults'],
    queryFn: () => api.getVaults(),
  })

  const errorMessage = error?.message ?? null

  const vaultGroups = useMemo(
    () => groupVaultsByOwner(vaults, user?.github_username),
    [vaults, user?.github_username]
  )

  // Count vaults that are read-only due to plan limit exceeded
  const readonlyDueToPlanLimit = useMemo(() => {
    return vaults.filter(v => v.is_read_only && v.readonly_reason === 'plan_limit_exceeded').length
  }, [vaults])

  useEffect(() => {
    if (!hasFiredView.current) {
      hasFiredView.current = true
      trackEvent(AnalyticsEvents.DASHBOARD_VIEW)
    }
  }, [])

  const handleDeleteVault = async () => {
    if (!vaultToDelete) return
    await api.deleteVault(vaultToDelete.repo_owner, vaultToDelete.repo_name)
    queryClient.setQueryData<Vault[]>(['vaults'], (old) =>
      old?.filter((v) => v.id !== vaultToDelete.id)
    )
  }

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto">
        {isLoading ? (
          <div className="space-y-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="size-5 rounded bg-muted animate-pulse" />
                <div className="h-4 w-32 rounded bg-muted animate-pulse" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(4)].map((_, i) => (
                  <VaultCardSkeleton key={i} />
                ))}
              </div>
            </div>
          </div>
        ) : errorMessage?.includes('GitHub App not installed') ? (
          <GitHubAppNotInstalledState error={errorMessage} onRetry={() => refetch()} />
        ) : errorMessage ? (
          <ErrorState message={errorMessage} onRetry={() => refetch()} />
        ) : vaults.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="relative mb-6">
              <div className="absolute inset-0 bg-emerald-500/20 blur-xl rounded-full" />
              <div className="relative flex size-20 items-center justify-center rounded-2xl bg-linear-to-br from-emerald-500 to-emerald-600 shadow-lg">
                <svg className="size-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
            </div>

            <h3 className="text-2xl font-semibold text-foreground mb-2">Welcome to Keyway</h3>
            <p className="text-muted-foreground text-center max-w-md mb-8">
              Sync your <code className="text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">.env</code> with your team in seconds.
              No more sharing secrets on Slack.
            </p>

            <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full shadow-xs">
              <p className="text-sm font-medium text-foreground mb-3">Install Keyway CLI:</p>
              <CLICommand />
            </div>

            <div className="flex items-center gap-6 mt-8 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <svg className="size-4 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>AES-256 encryption</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="size-4 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>GitHub permissions</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Plan limit exceeded banner */}
            {readonlyDueToPlanLimit > 0 && user && (
              <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-900/20">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-400">
                      {readonlyDueToPlanLimit} vault{readonlyDueToPlanLimit > 1 ? 's are' : ' is'} read-only
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
                      Your {user.plan} plan allows {PLAN_LIMITS[user.plan]} private vault{PLAN_LIMITS[user.plan] === 1 ? '' : 's'}.
                      Your oldest vaults remain writable, newer ones are read-only.{' '}
                      <Link href="/upgrade" className="underline hover:no-underline">
                        Upgrade your plan
                      </Link>
                    </p>
                  </div>
                </div>
              </div>
            )}

            {vaultGroups.map((group) => (
              <section key={group.owner}>
                <div className="flex items-center gap-2 mb-4">
                  {group.isPersonal ? (
                    <User className="size-4 text-muted-foreground" />
                  ) : (
                    <Building2 className="size-4 text-muted-foreground" />
                  )}
                  <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {group.isPersonal ? 'Personal Vaults' : group.owner}
                  </h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.vaults.map((vault) => (
                    <VaultCard key={vault.id} vault={vault} onDelete={setVaultToDelete} />
                  ))}
                  <CreateVaultCard />
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <DeleteVaultModal
        isOpen={!!vaultToDelete}
        onClose={() => setVaultToDelete(null)}
        onConfirm={handleDeleteVault}
        vault={vaultToDelete}
      />
    </DashboardLayout>
  )
}
