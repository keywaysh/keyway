'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Users, RefreshCw, Crown, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'
import type { OrganizationDetails, OrganizationMember } from '@/lib/types'
import { DashboardLayout, ErrorState, LoadingSpinner } from '@/app/components/dashboard'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'

function MemberRowSkeleton() {
  return (
    <div className="flex items-center gap-4 py-3 px-4">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-1">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-5 w-16" />
    </div>
  )
}

interface MemberCardProps {
  member: OrganizationMember
  orgLogin: string
}

function MemberCard({ member, orgLogin }: MemberCardProps) {
  return (
    <div className="flex items-center gap-4 py-3 px-4 hover:bg-accent/50 rounded-lg transition-colors">
      <Avatar className="h-10 w-10">
        <AvatarImage src={member.avatar_url} alt={member.username} />
        <AvatarFallback>{member.username[0].toUpperCase()}</AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium truncate">{member.username}</p>
          {member.role === 'owner' && (
            <Badge variant="outline" className="text-xs gap-1">
              <Crown className="h-3 w-3" />
              Owner
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Joined {new Date(member.joined_at).toLocaleDateString()}
        </p>
      </div>

      <Button variant="ghost" size="icon" asChild>
        <a
          href={`https://github.com/${member.username}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink className="h-4 w-4" />
          <span className="sr-only">View on GitHub</span>
        </a>
      </Button>
    </div>
  )
}

export default function OrganizationMembersPage() {
  const params = useParams()
  const orgLogin = params.org as string

  const [org, setOrg] = useState<OrganizationDetails | null>(null)
  const [members, setMembers] = useState<OrganizationMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      try {
        const [orgData, membersData] = await Promise.all([
          api.getOrganization(orgLogin),
          api.getOrganizationMembers(orgLogin),
        ])
        setOrg(orgData)
        setMembers(membersData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load members')
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [orgLogin])

  const handleSync = async () => {
    setIsSyncing(true)
    try {
      const result = await api.syncOrganizationMembers(orgLogin)
      toast.success(result.message, {
        description: `Added: ${result.added}, Updated: ${result.updated}, Removed: ${result.removed}`,
      })
      // Refresh members
      const membersData = await api.getOrganizationMembers(orgLogin)
      setMembers(membersData)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to sync members')
    } finally {
      setIsSyncing(false)
    }
  }

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2 mb-6">
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-6 w-48" />
          </div>
          <Card>
            <CardContent className="p-0">
              <MemberRowSkeleton />
              <MemberRowSkeleton />
              <MemberRowSkeleton />
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    )
  }

  if (error || !org) {
    return (
      <DashboardLayout>
        <ErrorState
          title="Failed to load members"
          message={error || 'Organization not found'}
          onRetry={() => window.location.reload()}
        />
      </DashboardLayout>
    )
  }

  const isOwner = org.role === 'owner'
  const owners = members.filter(m => m.role === 'owner')
  const regularMembers = members.filter(m => m.role === 'member')

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/orgs/${orgLogin}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Members</h1>
            <p className="text-sm text-muted-foreground">
              {org.display_name || org.login} - {members.length} members
            </p>
          </div>
        </div>

        {isOwner && (
          <Button
            variant="outline"
            onClick={handleSync}
            disabled={isSyncing}
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing...' : 'Sync from GitHub'}
          </Button>
        )}
      </div>

      {/* Members List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Organization Members
          </CardTitle>
          <CardDescription>
            Members are synced from your GitHub organization
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {members.length === 0 ? (
            <div className="p-8 text-center">
              <Users className="h-12 w-12 mx-auto text-muted-foreground/50" />
              <p className="mt-2 text-muted-foreground">No members found</p>
              {isOwner && (
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={handleSync}
                  disabled={isSyncing}
                >
                  <RefreshCw className={`h-4 w-4 mr-1.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  Sync Members
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {/* Owners first */}
              {owners.length > 0 && (
                <div className="p-2">
                  <p className="text-xs font-medium text-muted-foreground px-4 py-2">
                    Owners ({owners.length})
                  </p>
                  {owners.map((member) => (
                    <MemberCard key={member.id} member={member} orgLogin={orgLogin} />
                  ))}
                </div>
              )}

              {/* Regular members */}
              {regularMembers.length > 0 && (
                <div className="p-2">
                  <p className="text-xs font-medium text-muted-foreground px-4 py-2">
                    Members ({regularMembers.length})
                  </p>
                  {regularMembers.map((member) => (
                    <MemberCard key={member.id} member={member} orgLogin={orgLogin} />
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info */}
      <div className="text-sm text-muted-foreground text-center">
        <p>
          Members are automatically synced from GitHub.{' '}
          {isOwner && (
            <span>Click &quot;Sync from GitHub&quot; to update the member list.</span>
          )}
        </p>
      </div>
      </div>
    </DashboardLayout>
  )
}
