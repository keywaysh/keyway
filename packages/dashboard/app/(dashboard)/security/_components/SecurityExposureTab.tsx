'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Users,
  Key,
  Activity,
  Shield,
  Clock,
  Info,
  Download,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Sparkles,
  Building2,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatRelativeTime } from '@/lib/date-utils'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import type {
  ExposureOrgSummary,
  ExposureUserReport,
  ExposureUserSummary,
  Organization,
} from '@/lib/types'
import { ErrorState, ExposureStatCard } from '@/app/components/dashboard'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type PeriodFilter = 'all' | '30d' | '90d' | '1y'

function getPeriodDays(period: PeriodFilter): number | null {
  switch (period) {
    case '30d':
      return 30
    case '90d':
      return 90
    case '1y':
      return 365
    default:
      return null
  }
}

type RoleBadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

function getRoleBadgeProps(role: string): {
  variant: RoleBadgeVariant
  className: string
} {
  switch (role) {
    case 'admin':
      return { variant: 'destructive', className: 'text-xs' }
    case 'maintain':
    case 'write':
      return { variant: 'default', className: 'text-xs bg-amber-500 hover:bg-amber-500/80' }
    case 'read':
    default:
      return { variant: 'secondary', className: 'text-xs' }
  }
}

function generateCSV(userReports: Record<string, ExposureUserReport>): string {
  const rows: string[] = ['Username,Vault,Secret,Environment,Role,Access Count,Last Access']

  for (const [username, report] of Object.entries(userReports)) {
    for (const vault of report.vaults) {
      for (const secret of vault.secrets) {
        rows.push(
          [
            username,
            vault.repoFullName,
            secret.key,
            secret.environment,
            secret.roleAtAccess,
            secret.accessCount.toString(),
            new Date(secret.lastAccess).toISOString(),
          ]
            .map((v) => `"${v.replace(/"/g, '""')}"`)
            .join(',')
        )
      }
    }
  }

  return rows.join('\n')
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function ExposureUserRowSkeleton() {
  return (
    <div className="border rounded-lg p-4 flex items-center gap-4">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-4 w-20" />
    </div>
  )
}

function GlobalExposureUserRow({
  user,
  isExpanded,
  onToggle,
  userReport,
  isLoadingReport,
}: {
  user: ExposureUserSummary
  isExpanded: boolean
  onToggle: () => void
  userReport: ExposureUserReport | null
  isLoadingReport: boolean
}) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="w-full p-4 flex items-center gap-4 hover:bg-accent/50 transition-colors text-left"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarImage src={user.user.avatarUrl || undefined} alt={user.user.username} />
            <AvatarFallback>{user.user.username[0].toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{user.user.username}</p>
            <p className="text-sm text-muted-foreground">
              Last access: {formatRelativeTime(user.lastAccess)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="secondary" className="text-xs">
            <Key className="h-3 w-3 mr-1" />
            {user.secretsAccessed}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {user.vaultsAccessed} {user.vaultsAccessed === 1 ? 'vault' : 'vaults'}
          </Badge>
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground ml-1" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground ml-1" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t bg-muted/20">
          {isLoadingReport ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : userReport ? (
            <div className="divide-y">
              {userReport.vaults.map((vault) => (
                <div key={vault.repoFullName} className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="font-medium text-sm">{vault.repoFullName}</span>
                    <Link
                      href={`/vaults/${vault.repoFullName}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                  <div className="space-y-2">
                    {vault.secrets.map((secret) => (
                      <div
                        key={`${secret.key}-${secret.environment}`}
                        className="flex flex-wrap items-center gap-2 text-sm py-1 pl-4 border-l-2 border-muted"
                      >
                        <code className="bg-muted px-2 py-0.5 rounded text-xs font-mono">
                          {secret.key}
                        </code>
                        <Badge variant="outline" className="text-xs">
                          {secret.environment}
                        </Badge>
                        <Badge
                          {...getRoleBadgeProps(secret.roleAtAccess)}
                          className={`${getRoleBadgeProps(secret.roleAtAccess).className} capitalize`}
                        >
                          {secret.roleAtAccess}
                        </Badge>
                        <span className="text-muted-foreground text-xs ml-auto">
                          {secret.accessCount}× · {formatRelativeTime(secret.lastAccess)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">No detailed data available</p>
          )}
        </div>
      )}
    </div>
  )
}

function UpgradePrompt() {
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="py-8">
        <div className="text-center max-w-md mx-auto">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Exposure Tracking</h3>
          <p className="text-muted-foreground mb-4">
            See which team members have accessed each secret. Essential for offboarding and security
            audits.
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            Upgrade to Team plan to unlock exposure tracking across all your vaults.
          </p>
          <Button asChild>
            <Link href="/settings/billing">Upgrade to Team</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function SecurityExposureTab() {
  const { user } = useAuth()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [selectedOrg, setSelectedOrg] = useState<string>('all')
  const [exposure, setExposure] = useState<ExposureOrgSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [userReports, setUserReports] = useState<Record<string, ExposureUserReport>>({})
  const [loadingReports, setLoadingReports] = useState<Set<string>>(new Set())
  const [period, setPeriod] = useState<PeriodFilter>('all')
  const [isExporting, setIsExporting] = useState(false)
  const hasFiredView = useRef(false)

  // Check if user has team plan
  const hasTeamPlan = user?.plan === 'team'

  // Fetch organizations
  useEffect(() => {
    if (!hasTeamPlan) {
      setIsLoadingOrgs(false)
      return
    }

    api
      .getOrganizations()
      .then((orgs) => {
        setOrganizations(orgs)
      })
      .catch(() => {
        // Silently fail - orgs dropdown just won't show
      })
      .finally(() => {
        setIsLoadingOrgs(false)
      })
  }, [hasTeamPlan])

  // Fetch exposure data
  const loadExposure = useCallback(async () => {
    if (!hasTeamPlan) {
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)
    setExpandedUser(null)
    setUserReports({})

    try {
      let data: ExposureOrgSummary
      if (selectedOrg === 'all') {
        data = await api.getMyExposure()
      } else {
        data = await api.getOrganizationExposure(selectedOrg)
      }
      setExposure(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load exposure data')
    } finally {
      setIsLoading(false)
    }
  }, [hasTeamPlan, selectedOrg])

  useEffect(() => {
    if (!hasFiredView.current) {
      hasFiredView.current = true
      trackEvent(AnalyticsEvents.SECURITY_EXPOSURE_VIEW)
    }
    loadExposure()
  }, [loadExposure])

  const handleOrgChange = (orgLogin: string) => {
    setSelectedOrg(orgLogin)
    trackEvent(AnalyticsEvents.EXPOSURE_PERIOD_FILTER, { org: orgLogin })
  }

  const handleToggleUser = async (username: string) => {
    if (expandedUser === username) {
      setExpandedUser(null)
      return
    }

    setExpandedUser(username)
    trackEvent(AnalyticsEvents.EXPOSURE_USER_EXPAND, { username, org: selectedOrg })

    // Load user report if not already loaded
    const cacheKey = `${selectedOrg}:${username}`
    if (!userReports[cacheKey] && !loadingReports.has(cacheKey)) {
      setLoadingReports((prev) => new Set(prev).add(cacheKey))
      try {
        let report: ExposureUserReport
        if (selectedOrg === 'all') {
          report = await api.getMyExposureUser(username)
        } else {
          report = await api.getUserExposure(selectedOrg, username)
        }
        setUserReports((prev) => ({ ...prev, [cacheKey]: report }))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load user report')
      } finally {
        setLoadingReports((prev) => {
          const next = new Set(prev)
          next.delete(cacheKey)
          return next
        })
      }
    }
  }

  // Filter users by period
  const filteredUsers = useMemo(() => {
    if (!exposure || period === 'all') return exposure?.users ?? []

    const days = getPeriodDays(period)
    if (!days) return exposure.users

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)

    return exposure.users.filter((user) => {
      const lastAccess = new Date(user.lastAccess)
      return lastAccess >= cutoff
    })
  }, [exposure, period])

  // Export all user reports
  const handleExport = async () => {
    if (!exposure) return

    setIsExporting(true)
    try {
      // Load all user reports if not already loaded
      const reportsToExport: Record<string, ExposureUserReport> = {}

      for (const u of filteredUsers) {
        const cacheKey = `${selectedOrg}:${u.user.username}`
        if (userReports[cacheKey]) {
          reportsToExport[u.user.username] = userReports[cacheKey]
        } else {
          let report: ExposureUserReport
          if (selectedOrg === 'all') {
            report = await api.getMyExposureUser(u.user.username)
          } else {
            report = await api.getUserExposure(selectedOrg, u.user.username)
          }
          reportsToExport[u.user.username] = report
          setUserReports((prev) => ({ ...prev, [cacheKey]: report }))
        }
      }

      const csv = generateCSV(reportsToExport)
      const date = new Date().toISOString().split('T')[0]
      const filename =
        selectedOrg === 'all'
          ? `exposure-report-${date}.csv`
          : `exposure-report-${selectedOrg}-${date}.csv`
      downloadCSV(csv, filename)
      trackEvent(AnalyticsEvents.EXPOSURE_CSV_EXPORT, {
        userCount: filteredUsers.length,
        period,
        org: selectedOrg,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export data')
    } finally {
      setIsExporting(false)
    }
  }

  // Show upgrade prompt if not on team plan
  if (!hasTeamPlan && !isLoading) {
    return <UpgradePrompt />
  }

  if (isLoading || isLoadingOrgs) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <div className="space-y-3">
          <ExposureUserRowSkeleton />
          <ExposureUserRowSkeleton />
          <ExposureUserRowSkeleton />
        </div>
      </div>
    )
  }

  // Check if error is plan-related
  const isPlanError = error?.toLowerCase().includes('team plan') || error?.toLowerCase().includes('upgrade')

  if (error && !isPlanError) {
    return (
      <ErrorState
        title="Failed to load exposure data"
        message={error}
        onRetry={() => loadExposure()}
      />
    )
  }

  if (!exposure && !isPlanError) {
    return (
      <ErrorState
        title="No exposure data"
        message="No secret access data has been recorded yet."
      />
    )
  }

  // Find the selected org details for upgrade link
  const selectedOrgDetails = organizations.find((org) => org.login === selectedOrg)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold">Exposure Report</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            See which secrets each team member has accessed. Useful for offboarding.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Organization selector - always visible */}
          {organizations.length > 0 && (
            <Select value={selectedOrg} onValueChange={handleOrgChange}>
              <SelectTrigger className="w-44">
                <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="All organizations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All organizations</SelectItem>
                {organizations.map((org) => (
                  <SelectItem key={org.id} value={org.login}>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-4 w-4">
                        <AvatarImage src={org.avatar_url} alt={org.login} />
                        <AvatarFallback className="text-[10px]">
                          {org.login.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      {org.login}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* Period selector and export - only when we have data */}
          {exposure && !isPlanError && (
            <>
              <Select
                value={period}
                onValueChange={(v) => {
                  setPeriod(v as PeriodFilter)
                  trackEvent(AnalyticsEvents.EXPOSURE_PERIOD_FILTER, { period: v })
                }}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All time</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                  <SelectItem value="1y">Last year</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={isExporting || filteredUsers.length === 0}
              >
                <Download className="h-4 w-4 mr-1" />
                {isExporting ? 'Exporting...' : 'Export CSV'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Plan upgrade prompt for selected org */}
      {isPlanError && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-8">
            <div className="text-center max-w-md mx-auto">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-6 h-6 text-amber-500" />
              </div>
              <h3 className="text-lg font-semibold mb-2">
                {selectedOrg === 'all' ? 'Upgrade Required' : `Upgrade ${selectedOrg}`}
              </h3>
              <p className="text-muted-foreground mb-4">
                {selectedOrg === 'all'
                  ? 'Exposure reports require a Team plan to track which secrets your team members have accessed.'
                  : `${selectedOrg} needs a Team plan to access exposure reports.`}
              </p>
              <p className="text-sm text-muted-foreground mb-6">
                {organizations.length > 0
                  ? 'Select another organization above, or upgrade to unlock exposure tracking.'
                  : 'Upgrade to Team plan to unlock exposure tracking.'}
              </p>
              <Button asChild>
                <Link
                  href={
                    selectedOrg !== 'all' && selectedOrgDetails
                      ? `/orgs/${selectedOrg}/billing`
                      : '/settings/billing'
                  }
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Upgrade to Team
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Content - only when we have data */}
      {exposure && !isPlanError && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ExposureStatCard icon={Users} label="Users with access" value={exposure.summary.users} />
            <ExposureStatCard icon={Key} label="Unique secrets" value={exposure.summary.secrets} />
            <ExposureStatCard icon={Activity} label="Total accesses" value={exposure.summary.accesses} />
          </div>

          {/* Info */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              This report tracks every{' '}
              <code className="bg-muted px-1 rounded text-xs">keyway pull</code> and secret view from
              the dashboard
              {selectedOrg === 'all' ? ' across all your vaults' : ` for ${selectedOrg}`}.
            </AlertDescription>
          </Alert>

          {/* Users list */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Users</CardTitle>
              <CardDescription>Click on a user to see which secrets they have accessed</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {filteredUsers.length === 0 ? (
                <div className="text-center py-8">
                  <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">
                    {period === 'all'
                      ? 'No secret accesses recorded yet.'
                      : `No accesses in the selected period.`}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {period === 'all'
                      ? 'Access data will appear here after team members pull or view secrets.'
                      : 'Try selecting a longer time period.'}
                  </p>
                </div>
              ) : (
                filteredUsers.map((u) => (
                  <GlobalExposureUserRow
                    key={u.user.username}
                    user={u}
                    isExpanded={expandedUser === u.user.username}
                    onToggle={() => handleToggleUser(u.user.username)}
                    userReport={userReports[`${selectedOrg}:${u.user.username}`] || null}
                    isLoadingReport={loadingReports.has(`${selectedOrg}:${u.user.username}`)}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
