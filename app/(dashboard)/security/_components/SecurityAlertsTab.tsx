'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import {
  Shield,
  AlertTriangle,
  MapPin,
  Smartphone,
  Zap,
  Globe,
  Monitor,
} from 'lucide-react'
import Link from 'next/link'
import { api } from '@/lib/api'
import type { SecurityAlert, SecurityAlertType } from '@/lib/types'
import { ErrorState, EmptyState } from '@/app/components/dashboard'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// Alert type configuration
const alertConfig: Record<
  SecurityAlertType,
  {
    icon: typeof AlertTriangle
    label: string
    severity: 'critical' | 'warning'
    description: string
  }
> = {
  impossible_travel: {
    icon: Zap,
    label: 'Impossible Travel',
    severity: 'critical',
    description: 'Access from locations too far apart in a short time',
  },
  weird_user_agent: {
    icon: Monitor,
    label: 'Suspicious Client',
    severity: 'critical',
    description: 'Access from an unrecognized client',
  },
  rate_anomaly: {
    icon: AlertTriangle,
    label: 'Unusual Activity',
    severity: 'critical',
    description: 'Abnormally high number of requests',
  },
  new_device: {
    icon: Smartphone,
    label: 'New Device',
    severity: 'warning',
    description: 'First access from this device',
  },
  new_location: {
    icon: MapPin,
    label: 'New Location',
    severity: 'warning',
    description: 'First access from this location',
  },
}

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

function AlertRowSkeleton() {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <Skeleton className="w-8 h-8 rounded-full shrink-0" />
      <div className="flex-1">
        <Skeleton className="h-4 w-48 mb-1.5" />
        <Skeleton className="h-3 w-64 mb-1" />
        <Skeleton className="h-3 w-40" />
      </div>
      <Skeleton className="h-3 w-14 shrink-0" />
    </div>
  )
}

function AlertRow({ alert }: { alert: SecurityAlert }) {
  const config = alertConfig[alert.type]
  const Icon = config.icon
  const locationStr = alert.event?.location
    ? [alert.event.location.city, alert.event.location.country]
        .filter(Boolean)
        .join(', ') || 'Unknown'
    : 'Unknown'

  // Parse vault name
  const vaultParts = alert.vault?.repoFullName?.split('/') || []
  const owner = vaultParts[0] || ''
  const repo = vaultParts[1] || ''
  const hasValidVault = owner && repo

  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      {/* Icon */}
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5',
          config.severity === 'critical'
            ? 'bg-destructive/10 text-destructive'
            : 'bg-amber-500/10 text-amber-600 dark:text-amber-500'
        )}
      >
        <Icon className="w-4 h-4" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Main line: alert type + badge */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-foreground">{config.label}</span>
          <Badge
            variant={config.severity === 'critical' ? 'destructive' : 'secondary'}
            className="text-xs"
          >
            {config.severity}
          </Badge>
        </div>

        {/* Message */}
        <p className="text-sm text-muted-foreground mt-0.5">{alert.message}</p>

        {/* Context line: vault, IP, location */}
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
          {hasValidVault && (
            <>
              <span>in</span>
              <Link
                href={`/vaults/${owner}/${repo}`}
                className="text-foreground/80 hover:text-primary transition-colors"
              >
                {alert.vault?.repoFullName}
              </Link>
              <span>·</span>
            </>
          )}
          {alert.event && (
            <>
              <span className="font-mono">{alert.event.ip}</span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Globe className="w-3 h-3" />
                {locationStr}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Timestamp */}
      <div className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
        {formatTime(alert.createdAt)}
      </div>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  variant = 'default',
}: {
  icon: typeof Shield
  label: string
  value: number
  variant?: 'default' | 'critical' | 'warning'
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
                  : 'bg-muted text-muted-foreground'
            )}
          >
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function SecurityAlertsTab() {
  const [alerts, setAlerts] = useState<SecurityAlert[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const hasFiredView = useRef(false)

  const fetchAlerts = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await api.getMySecurityAlerts({ limit: 100 })
      setAlerts(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load security alerts')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!hasFiredView.current) {
      hasFiredView.current = true
      trackEvent(AnalyticsEvents.SECURITY_ALERTS_VIEW)
    }
    fetchAlerts()
  }, [])

  // Calculate stats
  const stats = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    const criticalCount = alerts.filter(
      (a) => alertConfig[a.type].severity === 'critical'
    ).length

    const todayCount = alerts.filter((a) => {
      const alertDate = new Date(a.createdAt)
      return alertDate >= today
    }).length

    return {
      total: alerts.length,
      critical: criticalCount,
      today: todayCount,
    }
  }, [alerts])

  // Group alerts by date
  const groupedByDate = useMemo(() => {
    const groups = new Map<string, SecurityAlert[]>()

    for (const alert of alerts) {
      const key = getDateKey(alert.createdAt)
      const existing = groups.get(key) || []
      groups.set(key, [...existing, alert])
    }

    return groups
  }, [alerts])

  return (
    <>
      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard icon={Shield} label="Total Alerts" value={stats.total} />
        <StatCard
          icon={AlertTriangle}
          label="Critical"
          value={stats.critical}
          variant={stats.critical > 0 ? 'critical' : 'default'}
        />
        <StatCard
          icon={Zap}
          label="Today"
          value={stats.today}
          variant={stats.today > 0 ? 'warning' : 'default'}
        />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={fetchAlerts} />
      ) : isLoading ? (
        <Card>
          <CardContent className="pt-6">
            {[...Array(6)].map((_, i) => (
              <AlertRowSkeleton key={i} />
            ))}
          </CardContent>
        </Card>
      ) : alerts.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              title="No security alerts"
              message="Security alerts will appear here when unusual activity is detected on your vaults"
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Array.from(groupedByDate.entries()).map(([dateKey, dateAlerts]) => (
            <div key={dateKey}>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 px-1">
                {dateKey}
              </h3>
              <Card>
                <CardContent className="pt-2 pb-2">
                  {dateAlerts.map((alert) => (
                    <AlertRow key={alert.id} alert={alert} />
                  ))}
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
