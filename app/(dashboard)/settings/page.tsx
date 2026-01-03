'use client'

import { useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Moon, Sun, Monitor, ExternalLink, Github, Palette, CreditCard, Loader2, Sparkles, BarChart3 } from 'lucide-react'
import Link from 'next/link'
import { DashboardLayout } from '@/app/components/dashboard'
import { useAuth } from '@/lib/auth'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import { api } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

type UsageData = {
  plan: 'free' | 'pro' | 'team' | 'startup'
  limits: {
    maxPublicRepos: string | number
    maxPrivateRepos: string | number
    maxProviders: string | number
    maxEnvironmentsPerVault: string | number
    maxSecretsPerPrivateVault: string | number
  }
  usage: {
    public: number
    private: number
    providers: number
  }
}

type SubscriptionData = {
  subscription: {
    id: string
    status: string
    currentPeriodEnd: string
    cancelAtPeriodEnd: boolean
  } | null
  plan: 'free' | 'pro' | 'team' | 'startup'
  billingStatus: 'active' | 'past_due' | 'canceled' | 'trialing'
  stripeCustomerId: string | null
}

export default function SettingsPage() {
  const { user } = useAuth()
  const { theme, setTheme } = useTheme()
  const hasFiredView = useRef(false)

  // Fetch billing data with TanStack Query
  const { data: billingData, isLoading: billingLoading } = useQuery<SubscriptionData>({
    queryKey: ['subscription'],
    queryFn: () => api.getSubscription(),
  })

  // Fetch usage data with TanStack Query
  const { data: usageData, isLoading: usageLoading } = useQuery<UsageData>({
    queryKey: ['usage'],
    queryFn: () => api.getUsage(),
  })

  // Mutation for opening billing portal
  const portalMutation = useMutation({
    mutationFn: () => api.createPortalSession(window.location.href),
    onSuccess: ({ url }) => {
      window.location.href = url
    },
    onError: (error) => {
      console.error('Failed to open billing portal:', error)
    },
  })

  useEffect(() => {
    if (!hasFiredView.current) {
      hasFiredView.current = true
      trackEvent(AnalyticsEvents.SETTINGS_VIEW)
    }
  }, [])

  const handleManageBilling = () => {
    portalMutation.mutate()
  }

  const themeOptions = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ]

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h2 className="text-2xl font-bold mb-1 text-foreground">Settings</h2>
          <p className="text-muted-foreground">Manage your account and preferences</p>
        </div>

        <div className="space-y-6">
          {/* Profile Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Github className="h-5 w-5" />
                GitHub Account
              </CardTitle>
              <CardDescription>
                Your account is linked to GitHub for authentication
              </CardDescription>
            </CardHeader>
            <CardContent>
              {user && (
                <div className="flex items-center gap-4">
                  <Avatar className="h-16 w-16">
                    <AvatarImage src={user.avatar_url} alt={user.name} />
                    <AvatarFallback>{user.name?.charAt(0)?.toUpperCase() || 'U'}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <h3 className="font-semibold text-foreground">{user.name}</h3>
                    <p className="text-sm text-muted-foreground">@{user.github_username}</p>
                    <Badge variant="secondary" className="mt-2">
                      GitHub OAuth
                    </Badge>
                  </div>
                  <Button variant="outline" asChild>
                    <a
                      href={`https://github.com/${user.github_username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View Profile
                    </a>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Appearance Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5" />
                Appearance
              </CardTitle>
              <CardDescription>
                Customize how Keyway looks on your device
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Label className="text-sm font-medium">Theme</Label>
                  <p className="text-sm text-muted-foreground mb-3">
                    Select your preferred theme
                  </p>
                  <div className="flex gap-2">
                    {themeOptions.map((option) => {
                      const Icon = option.icon
                      return (
                        <Button
                          key={option.value}
                          variant={theme === option.value ? 'default' : 'outline'}
                          className="flex-1"
                          onClick={() => setTheme(option.value)}
                        >
                          <Icon className="h-4 w-4 mr-2" />
                          {option.label}
                        </Button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Billing Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Billing & Plan
              </CardTitle>
              <CardDescription>
                Manage your subscription and billing details
              </CardDescription>
            </CardHeader>
            <CardContent>
              {billingLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-9 w-32 mt-4" />
                </div>
              ) : billingData ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-semibold text-foreground capitalize">
                          {billingData.plan} Plan
                        </span>
                        {billingData.plan !== 'free' && (
                          <Badge
                            variant={
                              billingData.billingStatus === 'active'
                                ? 'default'
                                : billingData.billingStatus === 'past_due'
                                ? 'destructive'
                                : 'secondary'
                            }
                          >
                            {billingData.billingStatus === 'active'
                              ? 'Active'
                              : billingData.billingStatus === 'past_due'
                              ? 'Past Due'
                              : billingData.billingStatus === 'trialing'
                              ? 'Trial'
                              : 'Canceled'}
                          </Badge>
                        )}
                      </div>
                      {billingData.subscription && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {billingData.subscription.cancelAtPeriodEnd
                            ? `Cancels on ${new Date(billingData.subscription.currentPeriodEnd).toLocaleDateString()}`
                            : `Renews on ${new Date(billingData.subscription.currentPeriodEnd).toLocaleDateString()}`}
                        </p>
                      )}
                      {billingData.plan === 'free' && (
                        <p className="text-sm text-muted-foreground mt-1">
                          Unlimited public repos, 1 private repo
                        </p>
                      )}
                    </div>
                    {billingData.plan !== 'free' && (
                      <Badge variant="outline" className="text-primary">
                        {billingData.plan === 'pro' ? '$4/mo' : billingData.plan === 'team' ? '$15/mo' : '$39/mo'}
                      </Badge>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2">
                    {billingData.plan === 'free' ? (
                      <Button asChild>
                        <Link href="/upgrade">
                          <Sparkles className="h-4 w-4 mr-2" />
                          Upgrade to Pro
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={handleManageBilling}
                        disabled={portalMutation.isPending}
                      >
                        {portalMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <ExternalLink className="h-4 w-4 mr-2" />
                        )}
                        Manage Billing
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Unable to load billing information
                </div>
              )}
            </CardContent>
          </Card>

          {/* Usage Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Usage
              </CardTitle>
              <CardDescription>
                Your current resource usage and plan limits
              </CardDescription>
            </CardHeader>
            <CardContent>
              {usageLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ) : usageData ? (
                <div className="space-y-6">
                  {/* Private Repos */}
                  <UsageItem
                    label="Private Repositories"
                    current={usageData.usage.private}
                    limit={usageData.limits.maxPrivateRepos}
                  />

                  {/* Providers */}
                  <UsageItem
                    label="Provider Connections"
                    current={usageData.usage.providers}
                    limit={usageData.limits.maxProviders}
                    description="Vercel, Netlify, etc."
                  />

                  {/* Environments */}
                  <UsageItem
                    label="Environments per Vault"
                    current={null}
                    limit={usageData.limits.maxEnvironmentsPerVault}
                    description="Per vault limit"
                  />

                  {/* Secrets */}
                  <UsageItem
                    label="Secrets per Private Vault"
                    current={null}
                    limit={usageData.limits.maxSecretsPerPrivateVault}
                    description="Per private vault limit"
                  />
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Unable to load usage information
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  )
}

function UsageItem({
  label,
  current,
  limit,
  description,
}: {
  label: string
  current: number | null
  limit: string | number
  description?: string
}) {
  const isUnlimited = limit === 'unlimited'
  const numericLimit = typeof limit === 'number' ? limit : 0
  const percentage = current !== null && !isUnlimited ? (current / numericLimit) * 100 : 0
  const isNearLimit = percentage >= 80
  const isAtLimit = percentage >= 100

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div>
          <span className="font-medium text-foreground">{label}</span>
          {description && (
            <span className="text-muted-foreground ml-2">({description})</span>
          )}
        </div>
        <span className={`font-mono ${isAtLimit ? 'text-destructive' : isNearLimit ? 'text-amber-500' : 'text-muted-foreground'}`}>
          {current !== null ? current : '—'} / {isUnlimited ? '∞' : limit}
        </span>
      </div>
      {current !== null && !isUnlimited && (
        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${isAtLimit ? 'bg-destructive' : isNearLimit ? 'bg-amber-500' : 'bg-primary'}`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}
