'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Settings, Save, Building2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { OrganizationDetails } from '@/lib/types'
import { DashboardLayout, ErrorState } from '@/app/components/dashboard'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'

export default function OrganizationSettingsPage() {
  const params = useParams()
  const orgLogin = params.org as string

  const [org, setOrg] = useState<OrganizationDetails | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasFiredView = useRef(false)

  useEffect(() => {
    if (!hasFiredView.current) {
      hasFiredView.current = true
      trackEvent(AnalyticsEvents.ORG_SETTINGS_VIEW, { org: orgLogin })
    }
  }, [orgLogin])

  useEffect(() => {
    async function loadData() {
      try {
        const orgData = await api.getOrganization(orgLogin)
        setOrg(orgData)
        setDisplayName(orgData.display_name || orgData.login)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load settings')
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [orgLogin])

  const handleSave = async () => {
    if (!org) return

    setIsSaving(true)
    try {
      await api.updateOrganization(orgLogin, { displayName })
      trackEvent(AnalyticsEvents.ORG_SETTINGS_SAVE, { org: orgLogin })
      toast.success('Settings saved')
      // Refresh org data
      const orgData = await api.getOrganization(orgLogin)
      setOrg(orgData)
      setDisplayName(orgData.display_name || orgData.login)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-2 mb-6">
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-6 w-48" />
          </div>
          <Skeleton className="h-64" />
        </div>
      </DashboardLayout>
    )
  }

  if (error || !org) {
    return (
      <DashboardLayout>
        <ErrorState
          title="Failed to load settings"
          message={error || 'Organization not found'}
          onRetry={() => window.location.reload()}
        />
      </DashboardLayout>
    )
  }

  const isOwner = org.role === 'owner'
  const hasChanges = displayName !== (org.display_name || org.login)

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/orgs/${orgLogin}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            {org.display_name || org.login}
          </p>
        </div>
      </div>

      {/* Organization Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Organization Profile
          </CardTitle>
          <CardDescription>
            Basic information about your organization
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Avatar and GitHub info */}
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={org.avatar_url} alt={org.display_name} />
              <AvatarFallback>
                <Building2 className="h-6 w-6" />
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">{org.display_name || org.login}</p>
              <p className="text-sm text-muted-foreground">@{org.login}</p>
              <a
                href={`https://github.com/${org.login}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline"
              >
                View on GitHub
              </a>
            </div>
          </div>

          <Separator />

          {/* Display Name */}
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={org.login}
              maxLength={100}
              disabled={!isOwner}
            />
            <p className="text-xs text-muted-foreground">
              This name will be shown in the dashboard instead of the GitHub login.
            </p>
          </div>
        </CardContent>
        {isOwner && (
          <CardFooter className="border-t pt-4">
            <Button
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
            >
              {isSaving ? (
                'Saving...'
              ) : (
                <>
                  <Save className="h-4 w-4 mr-1.5" />
                  Save Changes
                </>
              )}
            </Button>
          </CardFooter>
        )}
      </Card>

      {/* Organization Info */}
      <Card>
        <CardHeader>
          <CardTitle>Organization Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">GitHub Login</p>
              <p className="font-medium">{org.login}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Plan</p>
              <p className="font-medium capitalize">
                {org.effective_plan}
                {org.trial.status === 'active' && ' (Trial)'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Members</p>
              <p className="font-medium">{org.member_count}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Vaults</p>
              <p className="font-medium">{org.vault_count}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Your Role</p>
              <p className="font-medium capitalize">{org.role}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Created</p>
              <p className="font-medium">{new Date(org.created_at).toLocaleDateString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {!isOwner && (
        <Card className="bg-muted">
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">
              Only organization owners can modify settings.
            </p>
          </CardContent>
        </Card>
      )}
      </div>
    </DashboardLayout>
  )
}
