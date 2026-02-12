'use client'

import { useState, useEffect } from 'react'
import { LayoutDashboard, AlertTriangle, Users, History } from 'lucide-react'
import { DashboardLayout } from '@/app/components/dashboard'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import { SecurityOverviewTab } from './_components/SecurityOverviewTab'
import { SecurityAlertsTab } from './_components/SecurityAlertsTab'
import { SecurityExposureTab } from './_components/SecurityExposureTab'
import { SecurityAccessLogTab } from './_components/SecurityAccessLogTab'

const VALID_TABS = ['overview', 'alerts', 'exposure', 'access-log'] as const
type TabValue = (typeof VALID_TABS)[number]

function isValidTab(value: string): value is TabValue {
  return (VALID_TABS as readonly string[]).includes(value)
}

export default function SecurityPage() {
  const [tab, setTab] = useState<TabValue | null>(null)

  // Read hash on mount to support deep linking (e.g. #alerts)
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    setTab(isValidTab(hash) ? hash : 'overview')
  }, [])

  const handleTabChange = (value: string) => {
    if (isValidTab(value)) {
      setTab(value)
      window.history.replaceState(null, '', `#${value}`)
      trackEvent(AnalyticsEvents.SECURITY_TAB_CHANGE, { tab: value })
    }
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h2 className="text-2xl font-bold mb-1 text-foreground">Security</h2>
          <p className="text-muted-foreground">
            Monitor security and access across all your vaults
          </p>
        </div>

        {tab === null ? (
          <Skeleton className="h-10 w-80 mb-6" />
        ) : (
          <Tabs value={tab} onValueChange={handleTabChange}>
            <TabsList className="mb-6">
              <TabsTrigger value="overview" className="gap-2">
                <LayoutDashboard className="h-4 w-4" />
                <span className="hidden sm:inline">Overview</span>
              </TabsTrigger>
              <TabsTrigger value="alerts" className="gap-2">
                <AlertTriangle className="h-4 w-4" />
                <span className="hidden sm:inline">Alerts</span>
              </TabsTrigger>
              <TabsTrigger value="exposure" className="gap-2">
                <Users className="h-4 w-4" />
                <span className="hidden sm:inline">Exposure</span>
              </TabsTrigger>
              <TabsTrigger value="access-log" className="gap-2">
                <History className="h-4 w-4" />
                <span className="hidden sm:inline">Access Log</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <SecurityOverviewTab onNavigate={handleTabChange} />
            </TabsContent>
            <TabsContent value="alerts">
              <SecurityAlertsTab />
            </TabsContent>
            <TabsContent value="exposure">
              <SecurityExposureTab />
            </TabsContent>
            <TabsContent value="access-log">
              <SecurityAccessLogTab />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </DashboardLayout>
  )
}
