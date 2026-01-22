'use client'

import { useEffect, useState, useRef, useMemo, memo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Terminal,
  Globe,
  Code,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { api } from '@/lib/api'
import type { ActivityEvent, ActivityCategory } from '@/lib/types'
import {
  DashboardLayout,
  ErrorState,
  EmptyState,
} from '@/app/components/dashboard'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// Action labels for display
const actionLabels: Record<string, string> = {
  vault_created: 'created vault',
  vault_deleted: 'deleted vault',
  secrets_pushed: 'pushed secrets',
  secrets_pulled: 'pulled secrets',
  secret_created: 'created',
  secret_updated: 'updated',
  secret_deleted: 'deleted',
  secret_rotated: 'rotated',
  secret_value_accessed: 'viewed',
  secret_trashed: 'trashed',
  secret_restored: 'restored',
  secret_permanently_deleted: 'permanently deleted',
  secret_version_restored: 'restored version of',
  secret_version_value_accessed: 'viewed history of',
  environment_created: 'created environment',
  environment_renamed: 'renamed environment',
  environment_deleted: 'deleted environment',
  permission_changed: 'changed permissions',
  // Integration actions
  integration_connected: 'connected integration',
  integration_disconnected: 'disconnected integration',
  secrets_synced: 'synced secrets',
  // Billing actions
  plan_upgraded: 'upgraded plan',
  plan_downgraded: 'downgraded plan',
  // GitHub App actions
  github_app_installed: 'installed GitHub App',
  github_app_uninstalled: 'uninstalled GitHub App',
  // Auth actions
  user_login: 'logged in',
  // API Key actions
  api_key_created: 'created API key',
  api_key_revoked: 'revoked API key',
}

const platformIcons = {
  cli: <Terminal className="w-3 h-3" />,
  web: <Globe className="w-3 h-3" />,
  api: <Code className="w-3 h-3" />,
}

const categoryFilters: { id: ActivityCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'secrets', label: 'Secrets' },
  { id: 'access', label: 'Access' },
  { id: 'environments', label: 'Environments' },
  { id: 'vaults', label: 'Vaults' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'billing', label: 'Billing' },
  { id: 'account', label: 'Account' },
]

function getDateKey(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const eventDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  if (eventDate.getTime() === today.getTime()) return 'Today'
  if (eventDate.getTime() === yesterday.getTime()) return 'Yesterday'

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

interface GroupedActivity {
  id: string
  events: ActivityEvent[]
  action: ActivityEvent['action']
  vault_name: string
  user_name: string
  user_avatar: string
  platform: ActivityEvent['platform']
  timestamp: string
  // For display
  count: number
  secret_names: string[]
  environment?: string
}

function groupConsecutiveActions(events: ActivityEvent[]): GroupedActivity[] {
  const groups: GroupedActivity[] = []
  let currentGroup: GroupedActivity | null = null

  for (const event of events) {
    // Check if this event can be grouped with the current group
    // Must be same action, vault, user, environment, and within 5 minutes
    const canGroup =
      currentGroup &&
      currentGroup.action === event.action &&
      currentGroup.vault_name === event.vault_name &&
      currentGroup.user_name === event.user_name &&
      currentGroup.environment === event.environment &&
      // Within 5 minutes
      Math.abs(new Date(currentGroup.timestamp).getTime() - new Date(event.timestamp).getTime()) < 5 * 60 * 1000

    if (canGroup && currentGroup) {
      currentGroup.events.push(event)
      currentGroup.count++
      if (event.secret_name && !currentGroup.secret_names.includes(event.secret_name)) {
        currentGroup.secret_names.push(event.secret_name)
      }
    } else {
      // Start a new group
      currentGroup = {
        id: event.id,
        events: [event],
        action: event.action,
        vault_name: event.vault_name,
        user_name: event.user_name,
        user_avatar: event.user_avatar,
        platform: event.platform,
        timestamp: event.timestamp,
        count: 1,
        secret_names: event.secret_name ? [event.secret_name] : [],
        environment: event.environment,
      }
      groups.push(currentGroup)
    }
  }

  return groups
}

function groupEventsByDate(groups: GroupedActivity[]): Map<string, GroupedActivity[]> {
  const dateGroups = new Map<string, GroupedActivity[]>()

  for (const group of groups) {
    const key = getDateKey(group.timestamp)
    const existing = dateGroups.get(key) || []
    dateGroups.set(key, [...existing, group])
  }

  return dateGroups
}

function ActivityRowSkeleton() {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <Skeleton className="w-8 h-8 rounded-full shrink-0" />
      <div className="flex-1">
        <Skeleton className="h-4 w-56 mb-1.5" />
        <Skeleton className="h-3 w-40" />
      </div>
      <Skeleton className="h-3 w-14 shrink-0" />
    </div>
  )
}

const ActivityRow = memo(function ActivityRow({ group }: { group: GroupedActivity }) {
  const [expanded, setExpanded] = useState(false)
  const actionLabel = actionLabels[group.action] || group.action.replace(/_/g, ' ')

  // Safely parse vault name - fallback if invalid format
  const vaultParts = group.vault_name.split('/')
  const owner = vaultParts[0] || ''
  const repo = vaultParts[1] || ''
  const hasValidVault = owner && repo

  // Safe user name with fallback
  const userName = group.user_name || 'Unknown user'
  const userInitial = userName.charAt(0).toUpperCase()

  const isSecretAction = group.action.includes('secret') && !group.action.includes('secrets_')
  const showSecretName = isSecretAction && group.secret_names.length > 0
  const isGrouped = group.count > 1

  // Build the action description
  const renderActionText = () => {
    if (showSecretName) {
      if (isGrouped) {
        return (
          <>
            <span className="text-muted-foreground">{actionLabel}</span>{' '}
            <span className="font-medium text-foreground">{group.count} secrets</span>
          </>
        )
      }
      return (
        <>
          <span className="text-muted-foreground">{actionLabel}</span>{' '}
          <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-foreground">
            {group.secret_names[0]}
          </code>
        </>
      )
    }
    return <span className="text-muted-foreground">{actionLabel}</span>
  }

  return (
    <div className="border-b border-border last:border-0">
      <div
        className={cn(
          'flex items-start gap-3 py-3',
          isGrouped && 'cursor-pointer hover:bg-muted/50 rounded-md -mx-2 px-2'
        )}
        onClick={isGrouped ? () => setExpanded(!expanded) : undefined}
      >
        {/* Avatar */}
        {group.user_avatar ? (
          <Image
            src={group.user_avatar}
            alt={userName}
            width={32}
            height={32}
            className="rounded-full shrink-0 mt-0.5"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm text-muted-foreground shrink-0 mt-0.5">
            {userInitial}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Main line: username + action + object */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-foreground">{userName}</span>
            {renderActionText()}
            {isGrouped && (
              <span className="text-muted-foreground">
                {expanded ? (
                  <ChevronDown className="w-4 h-4 inline" />
                ) : (
                  <ChevronRight className="w-4 h-4 inline" />
                )}
              </span>
            )}
          </div>

          {/* Context line: vault, environment, platform */}
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
            <span>in</span>
            {hasValidVault ? (
              <Link
                href={`/vaults/${owner}/${repo}`}
                className="text-foreground/80 hover:text-primary transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                {group.vault_name}
              </Link>
            ) : (
              <span>{group.vault_name || 'unknown vault'}</span>
            )}
            {group.environment && (
              <>
                <span>·</span>
                <code className="font-mono bg-muted px-1 py-0.5 rounded text-foreground/70">
                  {group.environment}
                </code>
              </>
            )}
            <span>·</span>
            <span className="flex items-center gap-1">
              {platformIcons[group.platform]}
              <span className="capitalize">{group.platform}</span>
            </span>
          </div>
        </div>

        {/* Timestamp */}
        <div className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
          {formatTime(group.timestamp)}
        </div>
      </div>

      {/* Expanded details for grouped events */}
      {isGrouped && expanded && (
        <div className="ml-11 pb-3 space-y-1">
          {group.secret_names.map((name, i) => (
            <div key={i} className="text-xs text-muted-foreground flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-muted-foreground" />
              <code className="font-mono bg-muted px-1.5 py-0.5 rounded">{name}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

export default function ActivityPage() {
  const [selectedCategory, setSelectedCategory] = useState<ActivityCategory>('all')
  const hasFiredView = useRef(false)

  const {
    data: events = [],
    isLoading,
    error,
    refetch,
  } = useQuery<ActivityEvent[], Error>({
    queryKey: ['activity'],
    queryFn: () => api.getActivity(),
  })

  const errorMessage = error?.message ?? null

  useEffect(() => {
    if (!hasFiredView.current) {
      hasFiredView.current = true
      trackEvent(AnalyticsEvents.ACTIVITY_VIEW)
    }
  }, [])

  // Filter events by category
  const filteredEvents = useMemo(() => {
    if (selectedCategory === 'all') return events
    return events.filter((e) => e.category === selectedCategory)
  }, [events, selectedCategory])

  // Group consecutive similar actions
  const groupedActivities = useMemo(() => {
    return groupConsecutiveActions(filteredEvents)
  }, [filteredEvents])

  // Group by date
  const groupedByDate = useMemo(() => {
    return groupEventsByDate(groupedActivities)
  }, [groupedActivities])

  // Pre-calculate category counts for filter badges
  const categoryCounts = useMemo(() => {
    const counts: Record<ActivityCategory, number> = {
      all: events.length,
      secrets: 0,
      access: 0,
      environments: 0,
      vaults: 0,
      integrations: 0,
      billing: 0,
      account: 0,
    }
    for (const event of events) {
      if (event.category !== 'all') {
        counts[event.category]++
      }
    }
    return counts
  }, [events])

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h2 className="text-2xl font-bold mb-1 text-foreground">Activity</h2>
          <p className="text-muted-foreground">Recent actions across all your vaults</p>
        </div>

        {/* Category filters */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {categoryFilters.map((filter) => (
            <button
              key={filter.id}
              onClick={() => setSelectedCategory(filter.id)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-full transition-colors',
                selectedCategory === filter.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
              )}
            >
              {filter.label}
              {filter.id !== 'all' && categoryCounts[filter.id] > 0 && (
                <span className="ml-1.5 text-xs opacity-70">
                  {categoryCounts[filter.id]}
                </span>
              )}
            </button>
          ))}
        </div>

        {errorMessage ? (
          <ErrorState message={errorMessage} onRetry={() => refetch()} />
        ) : isLoading ? (
          <Card>
            <CardContent className="pt-6">
              {[...Array(8)].map((_, i) => (
                <ActivityRowSkeleton key={i} />
              ))}
            </CardContent>
          </Card>
        ) : filteredEvents.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <EmptyState
                title={selectedCategory === 'all' ? 'No activity yet' : `No ${selectedCategory} activity`}
                message={
                  selectedCategory === 'all'
                    ? 'Activity will appear here when you start using Keyway'
                    : 'Try selecting a different category'
                }
              />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {Array.from(groupedByDate.entries()).map(([dateKey, dateGroups]) => (
              <div key={dateKey}>
                <h3 className="text-sm font-medium text-muted-foreground mb-3 px-1">
                  {dateKey}
                </h3>
                <Card>
                  <CardContent className="pt-2 pb-2">
                    {dateGroups.map((group) => (
                      <ActivityRow key={group.id} group={group} />
                    ))}
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
