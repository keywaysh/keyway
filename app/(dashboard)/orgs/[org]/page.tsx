'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  Building2,
  Box,
  Settings,
  CreditCard,
  Sparkles,
  RefreshCw,
  Clock,
  Shield,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { OrganizationDetails } from '@/lib/types'
import { DashboardLayout, ErrorState } from '@/app/components/dashboard'
import { TrialBanner, TrialExpiredBanner } from '@/app/components/dashboard/TrialBanner'
import { OnboardingBanner } from '@/app/components/dashboard/OnboardingBanner'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'

function StatCard({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ElementType
  label: string
  value: string | number
  href?: string
}) {
  const content = (
    <Card className={href ? 'hover:bg-accent/50 transition-colors cursor-pointer' : ''}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-muted">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )

  if (href) {
    return <Link href={href}>{content}</Link>
  }

  return content
}

export default function OrganizationDashboardPage() {
  const params = useParams()
  const orgLogin = params.org as string
  const queryClient = useQueryClient()
  const [isStartingTrial, setIsStartingTrial] = useState(false)

  const {
    data: org,
    isLoading,
    error,
    refetch,
  } = useQuery<OrganizationDetails, Error>({
    queryKey: ['organization', orgLogin],
    queryFn: () => api.getOrganization(orgLogin),
  })

  const errorMessage = error?.message ?? null

  const handleStartTrial = async () => {
    if (!org) return

    setIsStartingTrial(true)
    try {
      const result = await api.startOrganizationTrial(orgLogin)
      toast.success(result.message)
      // Refresh org data
      await queryClient.invalidateQueries({ queryKey: ['organization', orgLogin] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start trial')
    } finally {
      setIsStartingTrial(false)
    }
  }

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <Skeleton className="h-16 w-16 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        </div>
      </DashboardLayout>
    )
  }

  if (errorMessage || !org) {
    return (
      <DashboardLayout>
        <ErrorState
          title="Failed to load organization"
          message={errorMessage || 'Organization not found'}
          onRetry={() => refetch()}
        />
      </DashboardLayout>
    )
  }

  const isOwner = org.role === 'owner'
  const canStartTrial = org.trial.status === 'none' && org.effective_plan === 'free'
  const showTrialBanner = org.trial.status === 'active'
  const showExpiredBanner = org.trial.status === 'expired' && org.effective_plan === 'free'

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14 sm:h-16 sm:w-16 shrink-0">
            <AvatarImage src={org.avatar_url} alt={org.display_name} />
            <AvatarFallback>
              <Building2 className="h-6 w-6" />
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">
                {org.display_name || org.login}
              </h1>
              <Badge variant={org.effective_plan === 'team' ? 'default' : 'secondary'}>
                {org.effective_plan === 'team' ? 'Team' : 'Free'}
              </Badge>
              {org.trial.status === 'active' && (
                <Badge variant="outline" className="gap-1">
                  <Clock className="h-3 w-3" />
                  Trial
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">@{org.login}</p>
          </div>
        </div>

        {isOwner && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/orgs/${orgLogin}/settings`}>
                <Settings className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Settings</span>
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/orgs/${orgLogin}/billing`}>
                <CreditCard className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Billing</span>
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Onboarding Banner (for newly connected orgs) */}
      <OnboardingBanner orgLogin={orgLogin} />

      {/* Trial Banner */}
      {showTrialBanner && (
        <TrialBanner trial={org.trial} orgLogin={orgLogin} />
      )}

      {showExpiredBanner && (
        <TrialExpiredBanner orgLogin={orgLogin} />
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard
          icon={Box}
          label="Vaults"
          value={org.vault_count}
        />
        <StatCard
          icon={org.effective_plan === 'team' ? Sparkles : Clock}
          label={org.effective_plan === 'team' ? 'Plan' : 'Trial Status'}
          value={
            org.effective_plan === 'team'
              ? 'Team'
              : org.trial.status === 'active'
              ? `${org.trial.days_remaining} days left`
              : 'Free'
          }
        />
      </div>

      {/* Start Trial CTA */}
      {canStartTrial && isOwner && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex items-center justify-center h-12 w-12 rounded-lg bg-primary/10 shrink-0">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Try Team for Free</h3>
                  <p className="text-muted-foreground mt-1">
                    Start a {org.trial.trial_duration_days}-day free trial. Get unlimited repos, environments,
                    and secrets for your organization. No credit card required.
                  </p>
                </div>
              </div>
              <Button
                onClick={handleStartTrial}
                disabled={isStartingTrial}
                className="w-full sm:w-auto shrink-0"
              >
                {isStartingTrial ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-1.5" />
                    Start Free Trial
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions */}
      {isOwner && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link href={`/orgs/${orgLogin}/exposure`}>
            <Card className="hover:bg-accent/50 transition-colors cursor-pointer h-full">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-muted">
                    <Shield className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium">Exposure Report</p>
                    <p className="text-sm text-muted-foreground">
                      See who accessed which secrets
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href={`/orgs/${orgLogin}/settings`}>
            <Card className="hover:bg-accent/50 transition-colors cursor-pointer h-full">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-muted">
                    <Settings className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium">Organization Settings</p>
                    <p className="text-sm text-muted-foreground">
                      Configure display name and permissions
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      )}
      </div>
    </DashboardLayout>
  )
}
