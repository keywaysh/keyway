'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Building2, Users, Box, Sparkles, ChevronRight, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import type { Organization } from '@/lib/types'
import { DashboardLayout, ErrorState, EmptyState } from '@/app/components/dashboard'
import { ConnectOrgModal } from '@/app/components/dashboard/ConnectOrgModal'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'

function OrgRowSkeleton() {
  return (
    <div className="flex items-center gap-4 p-4">
      <Skeleton className="size-10 rounded-lg" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3.5 w-32" />
      </div>
      <Skeleton className="size-5" />
    </div>
  )
}

interface OrgRowProps {
  org: Organization
}

function OrgRow({ org }: OrgRowProps) {
  const planBadgeConfig = {
    team: { label: 'Team', variant: 'default' as const },
    free: { label: 'Free', variant: 'secondary' as const },
  }

  const badge = planBadgeConfig[org.plan]

  return (
    <Link
      href={`/orgs/${org.login}`}
      className="flex items-center gap-4 p-4 hover:bg-accent/50 transition-colors group"
    >
      <Avatar className="size-10 rounded-lg">
        <AvatarImage src={org.avatar_url} alt={org.display_name} className="rounded-lg" />
        <AvatarFallback className="rounded-lg">
          <Building2 className="size-5" />
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-foreground truncate">
            {org.display_name || org.login}
          </h3>
          <Badge variant={badge.variant} className="text-xs shrink-0">
            {badge.label}
          </Badge>
          {org.role === 'owner' && (
            <Badge variant="outline" className="text-xs shrink-0">Owner</Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
          <span className="flex items-center gap-1">
            <Users className="size-3.5" />
            {org.member_count} {org.member_count === 1 ? 'member' : 'members'}
          </span>
          <span className="flex items-center gap-1">
            <Box className="size-3.5" />
            {org.vault_count} {org.vault_count === 1 ? 'vault' : 'vaults'}
          </span>
        </div>
      </div>

      <ChevronRight className="size-5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
    </Link>
  )
}

export default function OrganizationsPage() {
  const router = useRouter()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showConnectModal, setShowConnectModal] = useState(false)
  const hasFiredView = useRef(false)

  useEffect(() => {
    if (!hasFiredView.current) {
      hasFiredView.current = true
      trackEvent(AnalyticsEvents.ORG_LIST_VIEW)
    }
  }, [])

  const loadOrganizations = useCallback(async () => {
    try {
      const orgs = await api.getOrganizations()
      setOrganizations(orgs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load organizations')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadOrganizations()
  }, [loadOrganizations])

  const handleConnectOrg = async (orgLogin: string) => {
    const result = await api.connectOrganization(orgLogin)
    toast.success(`Connected to ${result.organization.login}!`)
    // Redirect to the org page
    router.push(`/orgs/${result.organization.login}?welcome=true`)
  }

  if (error) {
    return (
      <DashboardLayout>
        <ErrorState
          title="Failed to load organizations"
          message={error}
          onRetry={() => window.location.reload()}
        />
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Organizations</h1>
          <p className="text-muted-foreground mt-1">
            Manage your GitHub organizations and team billing
          </p>
        </div>
        <Button onClick={() => setShowConnectModal(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Connect Organization
        </Button>
      </div>

      {isLoading ? (
        <Card>
          <div className="divide-y divide-border">
            <OrgRowSkeleton />
            <OrgRowSkeleton />
            <OrgRowSkeleton />
          </div>
        </Card>
      ) : organizations.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No organizations connected"
          message="Connect your GitHub organizations to manage secrets across your team."
          action={
            <Button onClick={() => setShowConnectModal(true)} className="mt-2">
              <Plus className="h-4 w-4 mr-2" />
              Connect Organization
            </Button>
          }
        />
      ) : (
        <Card>
          <div className="divide-y divide-border">
            {organizations.map((org) => (
              <OrgRow key={org.id} org={org} />
            ))}
          </div>
        </Card>
      )}

      <div className="mt-8 p-4 rounded-lg bg-muted/50 border border-border">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-sm">Team Plan for Organizations</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Upgrade your organization to Team for unlimited repos, environments, and secrets.
              Start with a free 15-day trial, no credit card required.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href={`${process.env.NEXT_PUBLIC_LANDING_URL || 'https://www.keyway.sh'}/#pricing`} target="_blank" rel="noopener noreferrer">
              Learn More
            </Link>
          </Button>
        </div>
      </div>
      </div>

      <ConnectOrgModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        onConnect={handleConnectOrg}
      />
    </DashboardLayout>
  )
}
