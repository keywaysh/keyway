'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Users, Key, Activity, Shield, Clock, Info, Download } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import type { ExposureOrgSummary, ExposureUserReport } from '@/lib/types'
import {
  DashboardLayout,
  ErrorState,
  ExposureStatCard,
  ExposureUserRow,
  ExposureUserRowSkeleton,
} from '@/app/components/dashboard'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
    case '30d': return 30
    case '90d': return 90
    case '1y': return 365
    default: return null
  }
}

function generateCSV(userReports: Record<string, ExposureUserReport>): string {
  const rows: string[] = ['Username,Vault,Secret,Environment,Role,Access Count,Last Access']

  for (const [username, report] of Object.entries(userReports)) {
    for (const vault of report.vaults) {
      for (const secret of vault.secrets) {
        rows.push([
          username,
          vault.repoFullName,
          secret.key,
          secret.environment,
          secret.roleAtAccess,
          secret.accessCount.toString(),
          new Date(secret.lastAccess).toISOString(),
        ].map(v => `"${v.replace(/"/g, '""')}"`).join(','))
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

export default function ExposurePage() {
  const params = useParams()
  const orgLogin = params.org as string

  const [exposure, setExposure] = useState<ExposureOrgSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [userReports, setUserReports] = useState<Record<string, ExposureUserReport>>({})
  const [loadingReports, setLoadingReports] = useState<Set<string>>(new Set())
  const [period, setPeriod] = useState<PeriodFilter>('all')
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    trackEvent(AnalyticsEvents.EXPOSURE_VIEW, { org: orgLogin })
    async function loadExposure() {
      try {
        const data = await api.getOrganizationExposure(orgLogin)
        setExposure(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load exposure data')
      } finally {
        setIsLoading(false)
      }
    }
    loadExposure()
  }, [orgLogin])

  const handleToggleUser = async (username: string) => {
    if (expandedUser === username) {
      setExpandedUser(null)
      return
    }

    setExpandedUser(username)
    trackEvent(AnalyticsEvents.EXPOSURE_USER_EXPAND, { org: orgLogin, username })

    // Load user report if not already loaded
    if (!userReports[username] && !loadingReports.has(username)) {
      setLoadingReports((prev) => new Set(prev).add(username))
      try {
        const report = await api.getUserExposure(orgLogin, username)
        setUserReports((prev) => ({ ...prev, [username]: report }))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load user report')
      } finally {
        setLoadingReports((prev) => {
          const next = new Set(prev)
          next.delete(username)
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

    return exposure.users.filter(user => {
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
      const reportsToExport: Record<string, ExposureUserReport> = { ...userReports }

      for (const user of filteredUsers) {
        if (!reportsToExport[user.user.username]) {
          const report = await api.getUserExposure(orgLogin, user.user.username)
          reportsToExport[user.user.username] = report
        }
      }

      setUserReports(reportsToExport)

      const csv = generateCSV(reportsToExport)
      const date = new Date().toISOString().split('T')[0]
      downloadCSV(csv, `${orgLogin}-exposure-${date}.csv`)
      trackEvent(AnalyticsEvents.EXPOSURE_CSV_EXPORT, {
        org: orgLogin,
        userCount: filteredUsers.length,
        period,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export data')
    } finally {
      setIsExporting(false)
    }
  }

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
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
      </DashboardLayout>
    )
  }

  if (error) {
    return (
      <DashboardLayout>
        <ErrorState
          title="Failed to load exposure data"
          message={error}
          onRetry={() => window.location.reload()}
        />
      </DashboardLayout>
    )
  }

  if (!exposure) {
    return (
      <DashboardLayout>
        <ErrorState
          title="No exposure data"
          message="No secret access data has been recorded yet."
        />
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-bold tracking-tight">Exposure Report</h1>
            </div>
            <p className="text-muted-foreground">
              See which secrets each team member has accessed. Useful for offboarding.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={period} onValueChange={(v) => {
              setPeriod(v as PeriodFilter)
              trackEvent(AnalyticsEvents.EXPOSURE_PERIOD_FILTER, { org: orgLogin, period: v })
            }}>
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
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ExposureStatCard
            icon={Users}
            label="Users with access"
            value={exposure.summary.users}
          />
          <ExposureStatCard
            icon={Key}
            label="Unique secrets"
            value={exposure.summary.secrets}
          />
          <ExposureStatCard
            icon={Activity}
            label="Total accesses"
            value={exposure.summary.accesses}
          />
        </div>

        {/* Info */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            This report tracks every <code className="bg-muted px-1 rounded text-xs">keyway pull</code> and secret view from the dashboard.
            When someone leaves your team, you&apos;ll know exactly which secrets to rotate.
          </AlertDescription>
        </Alert>

        {/* Users list */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Users</CardTitle>
            <CardDescription>
              Click on a user to see which secrets they have accessed
            </CardDescription>
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
              filteredUsers.map((user) => (
                <ExposureUserRow
                  key={user.user.username}
                  user={user}
                  orgLogin={orgLogin}
                  isExpanded={expandedUser === user.user.username}
                  onToggle={() => handleToggleUser(user.user.username)}
                  userReport={userReports[user.user.username] || null}
                  isLoadingReport={loadingReports.has(user.user.username)}
                />
              ))
            )}
          </CardContent>
        </Card>

        {/* Back link */}
        <div>
          <Button variant="outline" asChild>
            <Link href={`/orgs/${orgLogin}`}>
              ← Back to {orgLogin}
            </Link>
          </Button>
        </div>
      </div>
    </DashboardLayout>
  )
}
