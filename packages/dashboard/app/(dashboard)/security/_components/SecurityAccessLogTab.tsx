'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import {
  History,
  Globe,
  AlertTriangle,
  User,
  ChevronDown,
  Eye,
  Download,
  Monitor,
  Terminal,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { AccessLogEvent, AccessLogResponse, Vault } from '@/lib/types'
import { ErrorState, EmptyState } from '@/app/components/dashboard'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/date-utils'

const formatAccessLogTime = (dateString: string) =>
  formatRelativeTime(dateString, {
    daysThreshold: 7,
    dateFormat: { month: 'short', day: 'numeric' },
  })

function AccessLogRowSkeleton() {
  return (
    <div className="flex items-center gap-4 py-3 border-b border-border last:border-0">
      <Skeleton className="h-8 w-8 rounded-full shrink-0" />
      <div className="flex-1 min-w-0">
        <Skeleton className="h-4 w-32 mb-1" />
        <Skeleton className="h-3 w-48" />
      </div>
      <Skeleton className="h-3 w-16" />
    </div>
  )
}

function getActionConfig(action: AccessLogEvent['action']) {
  switch (action) {
    case 'pull':
      return {
        icon: Download,
        label: 'pulled secrets from',
        color: 'text-blue-600 dark:text-blue-400',
        bgColor: 'bg-blue-100 dark:bg-blue-900/30',
      }
    case 'view':
      return {
        icon: Eye,
        label: 'viewed secret in',
        color: 'text-amber-600 dark:text-amber-400',
        bgColor: 'bg-amber-100 dark:bg-amber-900/30',
      }
    case 'view_version':
      return {
        icon: Eye,
        label: 'viewed secret version in',
        color: 'text-amber-600 dark:text-amber-400',
        bgColor: 'bg-amber-100 dark:bg-amber-900/30',
      }
    default:
      return {
        icon: Eye,
        label: 'accessed',
        color: 'text-muted-foreground',
        bgColor: 'bg-muted',
      }
  }
}

function AccessLogRow({ event }: { event: AccessLogEvent }) {
  const locationStr = event.location
    ? [event.location.city, event.location.country].filter(Boolean).join(', ') || null
    : null

  const vaultParts = event.vault?.repoFullName?.split('/') || []
  const owner = vaultParts[0] || ''
  const repo = vaultParts[1] || ''
  const hasValidVault = owner && repo

  const actionConfig = getActionConfig(event.action)
  const ActionIcon = actionConfig.icon

  // Determine platform icon
  const platform = event.metadata?.platform
  const PlatformIcon = platform === 'cli' ? Terminal : Monitor

  return (
    <div className="flex items-center gap-4 py-3 border-b border-border last:border-0">
      {/* User avatar */}
      <Avatar className="h-8 w-8 shrink-0">
        {event.user?.avatarUrl ? (
          <AvatarImage src={event.user.avatarUrl} alt={event.user.username} />
        ) : null}
        <AvatarFallback>
          {event.user?.username ? (
            event.user.username.slice(0, 2).toUpperCase()
          ) : (
            <User className="h-4 w-4" />
          )}
        </AvatarFallback>
      </Avatar>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-foreground">
            {event.user?.username || 'Unknown user'}
          </span>
          <span className="text-muted-foreground text-sm">{actionConfig.label}</span>
          {hasValidVault ? (
            <Link
              href={`/vaults/${owner}/${repo}`}
              className="text-sm font-medium text-foreground hover:text-primary transition-colors"
            >
              {event.vault?.repoFullName}
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground">Unknown vault</span>
          )}
          {event.metadata?.secretKey && (
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
              {event.metadata.secretKey}
            </code>
          )}
          {event.hasAlert && (
            <Badge variant="destructive" className="text-xs gap-1">
              <AlertTriangle className="h-3 w-3" />
              Alert
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          {event.ip && event.ip !== 'unknown' && (
            <>
              <span className="font-mono">{event.ip}</span>
              <span>·</span>
            </>
          )}
          {locationStr && (
            <>
              <span className="flex items-center gap-1">
                <Globe className="h-3 w-3" />
                {locationStr}
              </span>
              <span>·</span>
            </>
          )}
          <span className="flex items-center gap-1">
            <PlatformIcon className="h-3 w-3" />
            {platform === 'cli' ? 'CLI' : 'Dashboard'}
          </span>
          {event.metadata?.environment && (
            <>
              <span>·</span>
              <span>{event.metadata.environment}</span>
            </>
          )}
        </div>
      </div>

      {/* Timestamp */}
      <div className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
        {formatAccessLogTime(event.timestamp)}
      </div>
    </div>
  )
}

export function SecurityAccessLogTab() {
  const [events, setEvents] = useState<AccessLogEvent[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [vaultFilter, setVaultFilter] = useState<string>('all')
  const [vaults, setVaults] = useState<Vault[]>([])
  const hasFiredView = useRef(false)
  const limit = 20

  // Fetch vaults for filter dropdown
  useEffect(() => {
    api.getVaults().then(setVaults).catch(() => {})
  }, [])

  const fetchAccessLog = useCallback(
    async (offset = 0, append = false) => {
      if (offset === 0) {
        setIsLoading(true)
      } else {
        setIsLoadingMore(true)
      }
      setError(null)

      try {
        const options: { limit: number; offset: number; vaultId?: string } = {
          limit,
          offset,
        }
        if (vaultFilter !== 'all') {
          options.vaultId = vaultFilter
        }

        const data: AccessLogResponse = await api.getAccessLog(options)

        if (append) {
          setEvents((prev) => [...prev, ...data.events])
        } else {
          setEvents(data.events)
        }
        setTotal(data.total)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load access log')
      } finally {
        setIsLoading(false)
        setIsLoadingMore(false)
      }
    },
    [vaultFilter]
  )

  useEffect(() => {
    if (!hasFiredView.current) {
      hasFiredView.current = true
      trackEvent(AnalyticsEvents.SECURITY_ACCESS_LOG_VIEW)
    }
    fetchAccessLog()
  }, [fetchAccessLog])

  const handleLoadMore = () => {
    fetchAccessLog(events.length, true)
  }

  const hasMore = events.length < total

  if (error) {
    return <ErrorState message={error} onRetry={() => fetchAccessLog()} />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <History className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-lg font-semibold">Access Log</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Track who accessed secrets via CLI or dashboard
          </p>
        </div>
        <Select
          value={vaultFilter}
          onValueChange={(v) => {
            setVaultFilter(v)
            trackEvent(AnalyticsEvents.SECURITY_ACCESS_LOG_FILTER, { vaultId: v })
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All vaults" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All vaults</SelectItem>
            {vaults.map((vault) => (
              <SelectItem key={vault.id} value={vault.id}>
                {vault.repo_owner}/{vault.repo_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Access log list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent Activity</CardTitle>
          <CardDescription>
            {total > 0
              ? `Showing ${events.length} of ${total} events`
              : 'Access events will appear here'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div>
              {[...Array(5)].map((_, i) => (
                <AccessLogRowSkeleton key={i} />
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="py-8">
              <EmptyState
                title="No access events"
                message="Events will appear here when team members pull or view secrets from your vaults"
              />
            </div>
          ) : (
            <>
              <div>
                {events.map((event) => (
                  <AccessLogRow key={event.id} event={event} />
                ))}
              </div>

              {hasMore && (
                <div className="pt-4 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore ? (
                      'Loading...'
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1" />
                        Load more
                      </>
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
