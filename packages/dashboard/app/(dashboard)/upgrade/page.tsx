'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { CheckIcon } from '@heroicons/react/24/solid'
import { Loader2, Building2, User as UserIcon, Sparkles, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { currencySymbol, formatAmount } from '@/lib/api/billing'
import type { ApiPrice, PricesData, PlanPrices, SubscriptionData } from '@/lib/api/billing'
import type { Organization } from '@/lib/types'
import { useAuth } from '@/lib/auth'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'

const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'hello@keyway.sh'

const planFeatures = {
  free: [
    'Unlimited public repos',
    '10 private repos',
    '3 environments per vault',
    '2 provider integrations',
    'Unlimited collaborators',
  ],
  team: [
    'Unlimited private repos',
    'Unlimited environments',
    'Unlimited providers',
    'Organization-wide permissions',
    'Activity audit logs',
    'Unlimited members',
  ],
  business: [
    'Everything in Team',
    'Exposure reports (secret access tracking)',
    'Priority support',
    'Unlimited members',
  ],
}

type PaidTier = 'team' | 'business'
type BillingInterval = 'monthly' | 'yearly'

const TIER_LABELS: Record<PaidTier, string> = { team: 'Team', business: 'Business' }

// Fallback display when the prices API is unavailable (display only — real
// checkout always uses a live Stripe price id)
const FALLBACK_PRICES: Record<PaidTier, { monthly: number; yearly: number }> = {
  team: { monthly: 19, yearly: 190 },
  business: { monthly: 79, yearly: 790 },
}

function tierPricing(tier: PaidTier, prices: PlanPrices | undefined) {
  // Never mix live Stripe amounts with the hardcoded fallback: a partial
  // response (one interval unresolved) would otherwise advertise a yearly
  // price and savings % that don't exist in Stripe
  const useApi = Boolean(prices?.monthly && prices?.yearly)
  const sym = useApi ? currencySymbol(prices!.monthly!.currency) : '€'
  const monthly = useApi ? prices!.monthly!.price / 100 : FALLBACK_PRICES[tier].monthly
  const yearly = useApi ? prices!.yearly!.price / 100 : FALLBACK_PRICES[tier].yearly
  const savingsPct = Math.round((1 - yearly / (monthly * 12)) * 100)
  return { sym, monthly, yearly, savingsPct }
}

type CheckoutTarget = { kind: 'personal' } | { kind: 'org'; org: Organization }

type PendingCheckout = {
  tier: PaidTier
  interval: BillingInterval
  price: ApiPrice
  target: CheckoutTarget
}

export default function UpgradePage() {
  const { user } = useAuth()
  const [prices, setPrices] = useState<PricesData | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  // Step 1: plan+interval picked, choosing the account it applies to
  const [picking, setPicking] = useState<{ tier: PaidTier; interval: BillingInterval; price: ApiPrice } | null>(null)
  // Step 2: named confirmation before redirecting to Stripe
  const [pendingCheckout, setPendingCheckout] = useState<PendingCheckout | null>(null)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null) // null = loading
  const hasFiredView = useRef(false)

  // Check login status from cookie (same logic as lib/auth.tsx)
  // This runs client-side only to avoid hydration issues
  useEffect(() => {
    setIsLoggedIn(document.cookie.includes('keyway_logged_in=true'))
  }, [])

  useEffect(() => {
    if (!hasFiredView.current) {
      hasFiredView.current = true
      trackEvent(AnalyticsEvents.UPGRADE_VIEW)
    }
  }, [])

  useEffect(() => {
    async function fetchData() {
      try {
        const [priceData, subData, orgData] = await Promise.all([
          api.getPrices().catch((e) => {
            console.error('Failed to fetch prices:', e)
            return null
          }),
          api.getSubscription().catch((e) => {
            // Not logged in is expected, don't log as error
            if (!e.message?.includes('Unauthorized')) {
              console.error('Failed to fetch subscription:', e)
            }
            return null
          }),
          api.getOrganizations().catch(() => []),
        ])
        if (priceData) setPrices(priceData)
        if (subData) setSubscription(subData)
        setOrgs(orgData)
      } catch (error) {
        console.error('Failed to fetch pricing data:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const team = tierPricing('team', prices?.prices.team)
  const business = tierPricing('business', prices?.prices.business)

  const isSubscriptionActive =
    subscription?.billingStatus === 'active' || subscription?.billingStatus === 'trialing'
  const hasPersonalSubscription = isSubscriptionActive && subscription?.plan !== 'free'

  const apiPriceFor = (tier: PaidTier, interval: BillingInterval): ApiPrice | null =>
    (interval === 'monthly' ? prices?.prices[tier]?.monthly : prices?.prices[tier]?.yearly) ?? null

  const choosePlan = (tier: PaidTier, interval: BillingInterval) => {
    trackEvent(AnalyticsEvents.UPGRADE_CLICK, { plan: tier, interval })
    const price = apiPriceFor(tier, interval)
    if (!price) return
    setPicking({ tier, interval, price })
  }

  const chooseTarget = (target: CheckoutTarget) => {
    if (!picking) return
    setPendingCheckout({ ...picking, target })
    setPicking(null)
  }

  const startCheckout = async () => {
    if (!pendingCheckout) return
    const { tier, interval, price, target } = pendingCheckout
    trackEvent(AnalyticsEvents.CHECKOUT_START, {
      plan: tier,
      interval,
      account: target.kind === 'org' ? target.org.login : 'personal',
    })
    setIsRedirecting(true)
    try {
      const cancelUrl = window.location.href
      const { url } =
        target.kind === 'org'
          ? await api.createOrganizationCheckoutSession(
              target.org.login,
              price.id,
              `${window.location.origin}/orgs/${target.org.login}/billing?success=true`,
              cancelUrl
            )
          : await api.createCheckoutSession(
              price.id,
              `${window.location.origin}/settings?upgraded=true`,
              cancelUrl
            )
      window.location.href = url
    } catch (error) {
      console.error('Failed to start checkout:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to start checkout. Please try again.')
      // Keep the confirmation open so the user can retry or cancel in context
      setIsRedirecting(false)
    }
  }

  const targetName = (target: CheckoutTarget) =>
    target.kind === 'org'
      ? target.org.display_name || target.org.login
      : `${user?.github_username || 'your personal account'} (personal)`

  // CTA pair for a paid tier card
  const tierButtons = (tier: PaidTier, accent: string) => {
    if (isLoggedIn === false) {
      return (
        <Link
          href="/login?redirect=/upgrade"
          className={`block w-full py-2 px-4 rounded-lg text-center text-sm font-medium transition-colors ${accent} text-white`}
        >
          Login to upgrade
        </Link>
      )
    }
    const monthlyPrice = apiPriceFor(tier, 'monthly')
    const yearlyPrice = apiPriceFor(tier, 'yearly')
    if (!monthlyPrice || !yearlyPrice) {
      return (
        <a
          href={`mailto:${contactEmail}?subject=Upgrade to ${TIER_LABELS[tier]}`}
          className={`block w-full py-2 px-4 rounded-lg text-center text-sm font-medium transition-colors ${accent} text-white`}
        >
          Contact us to upgrade
        </a>
      )
    }
    return (
      <div className="flex gap-2">
        <button
          onClick={() => choosePlan(tier, 'monthly')}
          disabled={isRedirecting}
          aria-label={`Subscribe to ${TIER_LABELS[tier]} monthly`}
          className="flex-1 py-2 px-3 rounded-lg text-center text-sm font-medium transition-colors bg-gray-800 hover:bg-gray-700 text-white disabled:opacity-50"
        >
          <Zap className="inline size-4 mr-1" />
          Monthly
        </button>
        <button
          onClick={() => choosePlan(tier, 'yearly')}
          disabled={isRedirecting}
          aria-label={`Subscribe to ${TIER_LABELS[tier]} yearly`}
          className={`flex-1 py-2 px-3 rounded-lg text-center text-sm font-medium transition-colors ${accent} text-white disabled:opacity-50`}
        >
          <Sparkles className="inline size-4 mr-1" />
          Yearly
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-white font-bold text-lg">
            <div className="w-6 h-6 text-primary">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="2" y="4" width="8" height="16" rx="2" />
                <rect x="12" y="4" width="8" height="16" rx="2" transform="rotate(45 16 12)" />
              </svg>
            </div>
            Keyway
          </Link>
          {isLoggedIn === null ? (
            <span className="text-sm text-gray-600 w-16" />
          ) : isLoggedIn ? (
            <Link
              href="/"
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Dashboard
            </Link>
          ) : (
            <Link
              href="/login?redirect=/upgrade"
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Login
            </Link>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 px-4 py-16">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Upgrade your plan
            </h1>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto">
              One flat price per account — personal or organization. Unlimited members,
              unlimited repos: collaboration is never metered.
            </p>
          </div>

          {/* Existing personal subscription banner */}
          {hasPersonalSubscription && (
            <div className="mb-8 p-4 rounded-lg bg-primary/10 border border-primary/30 text-center">
              <p className="text-primary mb-2">
                Your personal account is on the{' '}
                <span className="font-semibold capitalize">{subscription?.plan}</span> plan.
              </p>
              <Link
                href="/settings"
                className="text-sm text-primary/80 hover:text-primary underline"
              >
                Manage your subscription in Settings
              </Link>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          ) : (
            <>
              {/* Plans grid */}
              <div className="grid md:grid-cols-3 gap-6 mb-12">
                {/* Free Plan */}
                <div className="rounded-2xl p-6 bg-gray-900 border border-gray-800">
                  <h2 className="text-xl font-bold text-white mb-1">Free</h2>
                  <p className="text-gray-400 text-sm mb-4">For getting started</p>
                  <div className="mb-6">
                    <span className="text-3xl font-bold text-white">{team.sym}0</span>
                    <span className="text-gray-400">/month</span>
                    <div className="text-sm text-gray-500 mt-1">Forever</div>
                  </div>
                  <ul className="space-y-3 mb-6">
                    {planFeatures.free.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm">
                        <CheckIcon className="w-5 h-5 text-primary shrink-0" />
                        <span className="text-gray-300">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="w-full py-2 px-4 rounded-lg bg-gray-800 text-gray-400 text-center text-sm">
                    {!hasPersonalSubscription ? 'Current plan' : 'Free tier'}
                  </div>
                </div>

                {/* Team Plan */}
                <div className="rounded-2xl p-6 bg-primary/10 border-2 border-primary">
                  <div className="text-primary text-sm font-medium mb-2">Most popular</div>
                  <h2 className="text-xl font-bold text-white mb-1">Team</h2>
                  <p className="text-gray-400 text-sm mb-4">
                    For organizations — or your personal account
                  </p>
                  <div className="mb-6">
                    <span className="text-3xl font-bold text-white">
                      {team.sym}
                      {team.monthly}
                    </span>
                    <span className="text-gray-400">/month</span>
                    <div className="text-sm text-gray-500 mt-1">
                      or {team.sym}
                      {team.yearly}/year{team.savingsPct > 0 ? ` (save ${team.savingsPct}%)` : ''}
                    </div>
                  </div>
                  <ul className="space-y-3 mb-6">
                    {planFeatures.team.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm">
                        <CheckIcon className="w-5 h-5 text-primary shrink-0" />
                        <span className="text-gray-300">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  {tierButtons('team', 'bg-primary hover:bg-primary/90')}
                </div>

                {/* Business Plan */}
                <div className="rounded-2xl p-6 bg-gray-900 border border-gray-800">
                  <div className="text-amber-400 text-sm font-medium mb-2">Governance</div>
                  <h2 className="text-xl font-bold text-white mb-1">Business</h2>
                  <p className="text-gray-400 text-sm mb-4">
                    For teams with compliance needs
                  </p>
                  <div className="mb-6">
                    <span className="text-3xl font-bold text-white">
                      {business.sym}
                      {business.monthly}
                    </span>
                    <span className="text-gray-400">/month</span>
                    <div className="text-sm text-gray-500 mt-1">
                      or {business.sym}
                      {business.yearly}/year
                      {business.savingsPct > 0 ? ` (save ${business.savingsPct}%)` : ''}
                    </div>
                  </div>
                  <ul className="space-y-3 mb-6">
                    {planFeatures.business.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm">
                        <CheckIcon className="w-5 h-5 text-primary shrink-0" />
                        <span className="text-gray-300">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  {tierButtons('business', 'bg-amber-600 hover:bg-amber-700')}
                </div>
              </div>

              {/* FAQ / Info section */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
                <p className="text-gray-400 mb-2">Secure payments powered by Stripe</p>
                <p className="text-gray-500 text-sm mb-2">
                  A subscription covers one GitHub account — your personal account or an
                  organization — with unlimited members either way.
                </p>
                <p className="text-gray-500 text-sm">
                  Cancel anytime. Need something more?{' '}
                  <a href={`mailto:${contactEmail}`} className="text-primary hover:underline">
                    Contact us
                  </a>
                </p>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Step 1 — account picker */}
      <Dialog open={picking !== null} onOpenChange={(open) => !open && setPicking(null)}>
        <DialogContent className="bg-gray-900 border-gray-800">
          <DialogHeader>
            <DialogTitle className="text-white">
              Who is this {picking ? TIER_LABELS[picking.tier] : ''} subscription for?
            </DialogTitle>
            <DialogDescription>
              A subscription covers a single GitHub account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <button
              onClick={() => chooseTarget({ kind: 'personal' })}
              disabled={hasPersonalSubscription}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-800 enabled:hover:border-gray-700 enabled:hover:bg-gray-800 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {user?.avatar_url ? (
                <Image
                  src={user.avatar_url}
                  alt={user.github_username || 'you'}
                  width={32}
                  height={32}
                  className="rounded-full"
                />
              ) : (
                <UserIcon className="size-8 text-gray-500" />
              )}
              <div className="flex-1">
                <div className="text-sm font-medium text-white">
                  {user?.github_username || 'Personal account'}
                </div>
                <div className="text-xs text-gray-500">
                  {hasPersonalSubscription
                    ? `already on ${subscription?.plan}`
                    : 'Personal account · covers your own repos'}
                </div>
              </div>
            </button>
            {[...orgs]
              .sort((a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1))
              .map((org) => {
                const alreadyPaid = org.plan !== 'free'
                // Only a confirmed member role disables the row: role can be
                // undefined against an older backend, and the checkout route
                // enforces ownership server-side anyway
                const notOwner = org.role === 'member'
                const disabled = alreadyPaid || notOwner
                return (
                  <button
                    key={org.id}
                    onClick={() => chooseTarget({ kind: 'org', org })}
                    disabled={disabled}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-800 enabled:hover:border-gray-700 enabled:hover:bg-gray-800 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {org.avatar_url ? (
                      <Image
                        src={org.avatar_url}
                        alt={org.login}
                        width={32}
                        height={32}
                        className="rounded-md"
                      />
                    ) : (
                      <Building2 className="size-8 text-gray-500" />
                    )}
                    <div className="flex-1">
                      <div className="text-sm font-medium text-white">
                        {org.display_name || org.login}
                      </div>
                      <div className="text-xs text-gray-500 capitalize">
                        {alreadyPaid
                          ? `already on ${org.plan}`
                          : notOwner
                            ? 'owners manage billing'
                            : 'organization'}
                      </div>
                    </div>
                  </button>
                )
              })}
            {orgs.length === 0 && (
              <p className="text-xs text-gray-500 pt-1">
                Have a GitHub organization?{' '}
                <Link href="/orgs" className="text-primary hover:underline">
                  Connect it first
                </Link>{' '}
                to subscribe it instead.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Step 2 — named confirmation. Rendered only while pending so the
          content can't blank out mid-close animation. */}
      {pendingCheckout && (
        <AlertDialog open onOpenChange={(open) => !open && !isRedirecting && setPendingCheckout(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Subscribe {targetName(pendingCheckout.target)} to{' '}
                {TIER_LABELS[pendingCheckout.tier]}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                <strong>{targetName(pendingCheckout.target)}</strong> will be subscribed to
                the {TIER_LABELS[pendingCheckout.tier]} plan for{' '}
                <strong>
                  {currencySymbol(pendingCheckout.price.currency)}
                  {formatAmount(pendingCheckout.price.price)}/
                  {pendingCheckout.interval === 'monthly' ? 'month' : 'year'}
                </strong>{' '}
                — one flat price covering every repo and member of that account. You&apos;ll
                be redirected to Stripe to complete the payment.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isRedirecting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  // Radix closes the dialog on Action click by default; keep it
                  // open so the loading state shows and errors land in context
                  e.preventDefault()
                  startCheckout()
                }}
                disabled={isRedirecting}
              >
                {isRedirecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  'Continue to checkout'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Footer */}
      <footer className="border-t border-gray-800 py-6">
        <div className="max-w-6xl mx-auto px-4 text-center text-sm text-gray-500">
          <p>
            Questions?{' '}
            <a href={`mailto:${contactEmail}`} className="text-primary hover:underline">
              Contact us
            </a>
          </p>
        </div>
      </footer>
    </div>
  )
}
