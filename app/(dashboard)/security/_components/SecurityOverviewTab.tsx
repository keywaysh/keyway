'use client'

import { useEffect, useState, useRef } from 'react'
import {
  AlertTriangle,
  ArrowDownToLine,
  Users,
  Shield,
  ChevronRight,
  Lock,
} from 'lucide-react'
import Link from 'next/link'
import { api } from '@/lib/api'
import type { SecurityOverview } from '@/lib/types'
import { ErrorState, EmptyState } from '@/app/components/dashboard'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SecurityOverviewTabProps {
  onNavigate: (tab: string) => void
}

function StatCardSkeleton() {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-3">
          <Skeleton className="w-10 h-10 rounded-lg" />
          <div>
            <Skeleton className="h-7 w-12 mb-1" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function OverviewStatCard({
  icon: Icon,
  label,
  value,
  subValue,
  variant = 'default',
}: {
  icon: typeof Shield
  label: string
  value: number
  subValue?: string
  variant?: 'default' | 'critical' | 'warning' | 'success'
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-10 h-10 rounded-lg flex items-center justify-center',
              variant === 'critical'
                ? 'bg-destructive/10 text-destructive'
                : variant === 'warning'
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-500'
                  : variant === 'success'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-500'
                    : 'bg-muted text-muted-foreground'
            )}
          >
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
            {subValue && (
              <p className="text-xs text-muted-foreground/70">{subValue}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function TopVaultRow({
  repoFullName,
  pullCount,
  maxCount,
}: {
  repoFullName: string
  pullCount: number
  maxCount: number
}) {
  const [owner, repo] = repoFullName.split('/')
  const percentage = maxCount > 0 ? (pullCount / maxCount) * 100 : 0

  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-1">
        <Link
          href={`/vaults/${owner}/${repo}`}
          className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate"
        >
          {repoFullName}
        </Link>
        <span className="text-sm text-muted-foreground ml-2">{pullCount}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}

function TopUserRow({
  username,
  avatarUrl,
  pullCount,
}: {
  username: string
  avatarUrl: string | null
  pullCount: number
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <Avatar className="h-6 w-6">
          <AvatarImage src={avatarUrl || undefined} alt={username} />
          <AvatarFallback className="text-xs">
            {username.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium text-foreground">{username}</span>
      </div>
      <span className="text-sm text-muted-foreground">{pullCount} pulls</span>
    </div>
  )
}

export function SecurityOverviewTab({ onNavigate }: SecurityOverviewTabProps) {
  const [overview, setOverview] = useState<SecurityOverview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const hasFiredView = useRef(false)

  const fetchOverview = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await api.getSecurityOverview()
      setOverview(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load security overview')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!hasFiredView.current) {
      hasFiredView.current = true
      trackEvent(AnalyticsEvents.SECURITY_OVERVIEW_VIEW)
    }
    fetchOverview()
  }, [])

  if (error) {
    return <ErrorState message={error} onRetry={fetchOverview} />
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Stat cards skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>

        {/* Content skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent>
              {[...Array(3)].map((_, i) => (
                <div key={i} className="py-2">
                  <Skeleton className="h-4 w-full mb-1" />
                  <Skeleton className="h-1.5 w-3/4" />
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-28" />
            </CardHeader>
            <CardContent>
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center gap-2 py-2">
                  <Skeleton className="h-6 w-6 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  if (!overview) {
    return (
      <Card>
        <CardContent className="py-12">
          <EmptyState
            title="No data available"
            message="Security overview data will appear here once you have activity in your vaults"
          />
        </CardContent>
      </Card>
    )
  }

  const maxVaultCount =
    overview.access.topVaults.length > 0
      ? Math.max(...overview.access.topVaults.map((v) => v.pullCount))
      : 0

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <OverviewStatCard
          icon={AlertTriangle}
          label="Alerts (7d)"
          value={overview.alerts.last7Days}
          subValue={`${overview.alerts.critical} critical`}
          variant={overview.alerts.critical > 0 ? 'critical' : 'default'}
        />
        <OverviewStatCard
          icon={ArrowDownToLine}
          label="Pulls (7d)"
          value={overview.access.last7Days}
          subValue={`${overview.access.totalPulls} total`}
        />
        <OverviewStatCard
          icon={Users}
          label="Users with Access"
          value={overview.exposure.usersWithAccess}
          subValue={
            overview.exposure.lastAccessAt
              ? `Last: ${new Date(overview.exposure.lastAccessAt).toLocaleDateString()}`
              : undefined
          }
        />
      </div>

      {/* Content grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top Accessed Vaults */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Lock className="w-4 h-4 text-muted-foreground" />
              Top Accessed Vaults
            </CardTitle>
          </CardHeader>
          <CardContent>
            {overview.access.topVaults.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No vault activity yet
              </p>
            ) : (
              <div className="divide-y divide-border">
                {overview.access.topVaults.slice(0, 5).map((vault) => (
                  <TopVaultRow
                    key={vault.repoFullName}
                    repoFullName={vault.repoFullName}
                    pullCount={vault.pullCount}
                    maxCount={maxVaultCount}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Most Active Users */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                Most Active Users
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => onNavigate('exposure')}
              >
                View exposure
                <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {overview.access.topUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No user activity yet
              </p>
            ) : (
              <div className="divide-y divide-border">
                {overview.access.topUsers.slice(0, 5).map((user) => (
                  <TopUserRow
                    key={user.username}
                    username={user.username}
                    avatarUrl={user.avatarUrl}
                    pullCount={user.pullCount}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      {overview.alerts.last7Days > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-500" />
                </div>
                <div>
                  <p className="font-medium text-foreground">
                    {overview.alerts.last7Days} alert
                    {overview.alerts.last7Days !== 1 ? 's' : ''} in the last 7 days
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Review security alerts to ensure your vaults are secure
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => onNavigate('alerts')}>
                View alerts
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
