'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  CreditCard,
  Sparkles,
  Check,
  Clock,
  RefreshCw,
  ExternalLink,
  Zap,
} from 'lucide-react'
import { api } from '@/lib/api'
import { currencySymbol, formatAmount } from '@/lib/api/billing'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import type { OrganizationDetails, OrganizationBillingStatus } from '@/lib/types'
import { DashboardLayout } from '@/app/components/dashboard/Layout'
import { ErrorState } from '@/app/components/dashboard/ErrorState'
import { TrialBanner, TrialExpiredBanner } from '@/app/components/dashboard/TrialBanner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'

const teamFeatures = [
  'Unlimited repositories',
  'Unlimited environments',
  'Organization-wide permissions',
  'Activity audit logs',
]

const businessFeatures = [
  'Everything in Team',
  'Exposure reports (secret access tracking)',
  'Priority support',
]

const freeFeatures = [
  'Unlimited public repositories',
  '10 private repositories',
  '3 environments per vault',
  'Unlimited collaborators',
  'CLI & Dashboard access',
]

function planLabel(plan: 'free' | 'team' | 'business'): string {
  return plan === 'business' ? 'Business' : plan === 'team' ? 'Team' : 'Free'
}

type TierPrices = NonNullable<OrganizationBillingStatus['prices']['team']>

type BillingInterval = 'monthly' | 'yearly'

function OrgPlanCard({
  name,
  prices,
  features,
  highlight,
  disabled,
  onChoose,
}: {
  name: string
  prices: TierPrices
  features: string[]
  highlight?: boolean
  disabled?: boolean
  onChoose: (price: TierPrices['monthly'], interval: BillingInterval) => void
}) {
  const sym = currencySymbol(prices.monthly.currency)
  const yearlySavingsPct = Math.round((1 - prices.yearly.price / (prices.monthly.price * 12)) * 100)
  return (
    <Card className={highlight ? 'border-2 border-primary relative' : 'border-2'}>
      {highlight && (
        <div className="absolute -top-3 left-4">
          <Badge className="bg-primary text-primary-foreground">Most features</Badge>
        </div>
      )}
      <CardContent className="p-4">
        <div className="font-semibold mb-1">{name}</div>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold">{sym}{formatAmount(prices.monthly.price)}</span>
          <span className="text-muted-foreground">/month</span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          or {sym}{formatAmount(prices.yearly.price)}/yr{yearlySavingsPct > 0 ? ` (save ${yearlySavingsPct}%)` : ''}
        </p>
        <ul className="space-y-1.5 mt-4">
          {features.map((feature) => (
            <li key={feature} className="flex items-center gap-2 text-sm text-muted-foreground">
              <Check className="h-4 w-4 text-primary shrink-0" />
              {feature}
            </li>
          ))}
        </ul>
        <div className="flex gap-2 mt-4">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onChoose(prices.monthly, 'monthly')}
            disabled={disabled}
            aria-label={`Subscribe to ${name} monthly`}
          >
            <Zap className="h-4 w-4 mr-1.5" />
            Monthly
          </Button>
          <Button
            className="flex-1"
            onClick={() => onChoose(prices.yearly, 'yearly')}
            disabled={disabled}
            aria-label={`Subscribe to ${name} yearly`}
          >
            <Sparkles className="h-4 w-4 mr-1.5" />
            Yearly
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default function OrganizationBillingPage() {
  const params = useParams()
  const orgLogin = params.org as string

  const [org, setOrg] = useState<OrganizationDetails | null>(null)
  const [billing, setBilling] = useState<OrganizationBillingStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isStartingTrial, setIsStartingTrial] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Named confirmation before checkout: the user sees exactly which
  // organization is being subscribed, to which plan, at what price
  const [pendingCheckout, setPendingCheckout] = useState<{
    plan: 'Team' | 'Business'
    price: TierPrices['monthly']
    interval: BillingInterval
  } | null>(null)

  useEffect(() => {
    async function loadData() {
      try {
        const [orgData, billingData] = await Promise.all([
          api.getOrganization(orgLogin),
          api.getOrganizationBilling(orgLogin).catch(() => null),
        ])
        setOrg(orgData)
        setBilling(billingData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load billing info')
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [orgLogin])

  const handleStartTrial = async () => {
    setIsStartingTrial(true)
    try {
      const result = await api.startOrganizationTrial(orgLogin)
      toast.success(result.message)
      // Refresh data
      const [orgData, billingData] = await Promise.all([
        api.getOrganization(orgLogin),
        api.getOrganizationBilling(orgLogin).catch(() => null),
      ])
      setOrg(orgData)
      setBilling(billingData)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start trial')
    } finally {
      setIsStartingTrial(false)
    }
  }

  const handleUpgrade = async (priceId: string) => {
    setIsRedirecting(true)
    try {
      const successUrl = `${window.location.origin}/orgs/${orgLogin}/billing?success=true`
      const cancelUrl = `${window.location.origin}/orgs/${orgLogin}/billing`
      const { url } = await api.createOrganizationCheckoutSession(orgLogin, priceId, successUrl, cancelUrl)
      window.location.href = url
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start checkout')
      setIsRedirecting(false)
    }
  }

  const handleManageBilling = async () => {
    setIsRedirecting(true)
    try {
      const returnUrl = `${window.location.origin}/orgs/${orgLogin}/billing`
      const { url } = await api.createOrganizationPortalSession(orgLogin, returnUrl)
      window.location.href = url
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open billing portal')
      setIsRedirecting(false)
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
          <div className="grid gap-6">
            <Skeleton className="h-48" />
            <Skeleton className="h-64" />
          </div>
        </div>
      </DashboardLayout>
    )
  }

  if (error || !org) {
    return (
      <DashboardLayout>
        <ErrorState
          title="Failed to load billing"
          message={error || 'Organization not found'}
          onRetry={() => window.location.reload()}
        />
      </DashboardLayout>
    )
  }

  const isOwner = org.role === 'owner'
  const canStartTrial = org.trial.status === 'none' && org.effective_plan === 'free'
  const hasActiveSubscription = billing?.subscription && billing.subscription.status === 'active'
  const showTrialBanner = org.trial.status === 'active'
  const showExpiredBanner = org.trial.status === 'expired' && org.effective_plan === 'free'

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/orgs/${orgLogin}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Billing</h1>
          <p className="text-sm text-muted-foreground">
            {org.display_name || org.login}
          </p>
        </div>
      </div>

      {/* Trial Banner */}
      {showTrialBanner && (
        <TrialBanner trial={org.trial} orgLogin={orgLogin} dismissable={false} />
      )}

      {showExpiredBanner && (
        <TrialExpiredBanner orgLogin={orgLogin} />
      )}

      {/* Current Plan */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Current Plan
              </CardTitle>
              <CardDescription>
                Your organization&apos;s subscription details
              </CardDescription>
            </div>
            <Badge variant={org.effective_plan !== 'free' ? 'default' : 'secondary'} className="text-sm">
              {planLabel(org.effective_plan)}
              {org.trial.status === 'active' && ' (Trial)'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {org.trial.status === 'active' && org.trial.days_remaining !== null && (
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>
                  Trial ends in <strong>{org.trial.days_remaining} days</strong>
                  {org.trial.ends_at && (
                    <span className="text-muted-foreground">
                      {' '}({new Date(org.trial.ends_at).toLocaleDateString()})
                    </span>
                  )}
                </span>
              </div>
            )}

            {hasActiveSubscription && billing?.subscription && (
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant="outline" className="capitalize">
                    {billing.subscription.status}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Next billing date</span>
                  <span>{new Date(billing.subscription.current_period_end).toLocaleDateString()}</span>
                </div>
                {billing.subscription.cancel_at_period_end && (
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
                    <Clock className="h-4 w-4" />
                    <span>Cancels at end of billing period</span>
                  </div>
                )}
              </div>
            )}

            <Separator />

            <div>
              <p className="text-sm font-medium mb-2">Included features:</p>
              <ul className="space-y-1.5">
                {(org.effective_plan === 'business'
                  ? [...teamFeatures, ...businessFeatures]
                  : org.effective_plan === 'team'
                  ? teamFeatures
                  : freeFeatures
                ).map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Check className="h-4 w-4 text-primary shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CardContent>
        {isOwner && hasActiveSubscription && (
          <CardFooter className="border-t pt-4 flex flex-col items-start gap-2">
            <Button
              variant="outline"
              onClick={handleManageBilling}
              disabled={isRedirecting}
            >
              {isRedirecting ? (
                <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <ExternalLink className="h-4 w-4 mr-1.5" />
              )}
              Manage Subscription
            </Button>
            {org.effective_plan === 'team' && (
              <p className="text-xs text-muted-foreground">
                Need Exposure reports? Switch to Business from Manage Subscription.
              </p>
            )}
          </CardFooter>
        )}
      </Card>

      {/* Plan selection — for orgs without a paid subscription. Active trials are
          included so owners can convert before the trial ends (the backend allows
          it); paid orgs change plans via the portal instead (avoids a 2nd sub). */}
      {isOwner && (org.effective_plan === 'free' || org.trial.status === 'active') && !hasActiveSubscription && (billing?.prices?.team || billing?.prices?.business) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Choose a plan
            </CardTitle>
            <CardDescription>
              Subscribe your organization to Team or Business.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              {billing?.prices?.team && (
                <OrgPlanCard
                  name="Team"
                  prices={billing.prices.team}
                  features={teamFeatures}
                  disabled={isRedirecting}
                  onChoose={(price, interval) => setPendingCheckout({ plan: 'Team', price, interval })}
                />
              )}
              {billing?.prices?.business && (
                <OrgPlanCard
                  name="Business"
                  prices={billing.prices.business}
                  features={businessFeatures}
                  highlight
                  disabled={isRedirecting}
                  onChoose={(price, interval) => setPendingCheckout({ plan: 'Business', price, interval })}
                />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Start Trial CTA */}
      {isOwner && canStartTrial && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex items-center justify-center h-12 w-12 rounded-lg bg-primary/10 shrink-0">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Not ready to commit?</h3>
                  <p className="text-muted-foreground mt-1">
                    Start a {org.trial.trial_duration_days}-day free trial. No credit card required.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
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
                    <Clock className="h-4 w-4 mr-1.5" />
                    Start Free Trial
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!isOwner && (
        <Card className="bg-muted">
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">
              Only organization owners can manage billing settings.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Named checkout confirmation. Rendered only while a checkout is
          pending so the content can't blank out mid-close animation. */}
      {pendingCheckout && (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingCheckout(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Subscribe {org.display_name || org.login} to {pendingCheckout.plan}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                The <strong>{org.login}</strong> organization will be subscribed to the{' '}
                {pendingCheckout.plan} plan for{' '}
                <strong>
                  {currencySymbol(pendingCheckout.price.currency)}
                  {formatAmount(pendingCheckout.price.price)}/
                  {pendingCheckout.interval === 'monthly' ? 'month' : 'year'}
                </strong>{' '}
                — one flat price, unlimited members. You&apos;ll be redirected to Stripe to
                complete the payment.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isRedirecting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  // Radix closes the dialog on Action click by default; keep
                  // it open so the loading state shows and errors land in
                  // context (retry stays possible)
                  e.preventDefault()
                  trackEvent(AnalyticsEvents.CHECKOUT_START, {
                    plan: pendingCheckout.plan.toLowerCase(),
                    interval: pendingCheckout.interval,
                    account: org.login,
                  })
                  handleUpgrade(pendingCheckout.price.id)
                }}
                disabled={isRedirecting}
              >
                {isRedirecting ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  'Continue to checkout'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      </div>
    </DashboardLayout>
  )
}
