'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { CheckIcon } from '@heroicons/react/24/solid'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'

const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'hello@keyway.sh'

type BillingInterval = 'monthly' | 'yearly'

type PriceData = {
  prices: {
    pro: {
      monthly: { id: string; price: number; interval: string }
      yearly: { id: string; price: number; interval: string }
    }
    team?: {
      monthly: { id: string; price: number; interval: string }
      yearly: { id: string; price: number; interval: string }
    }
    startup?: {
      monthly: { id: string; price: number; interval: string }
      yearly: { id: string; price: number; interval: string }
    }
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

const planFeatures = {
  free: [
    'Unlimited public repos',
    '1 private repo',
    '3 environments',
    '2 provider integrations',
    '15 collaborators per repo',
  ],
  pro: [
    '5 private repos',
    'Unlimited environments',
    'Unlimited providers',
    '15 collaborators per repo',
  ],
  team: [
    '10 private repos',
    'Unlimited environments',
    'Unlimited providers',
    'Audit logs',
    'Member management',
  ],
  startup: [
    '40 private repos',
    '30 collaborators per repo',
    'Unlimited providers',
    'Priority support',
    'Everything in Team',
  ],
}

export default function UpgradePage() {
  const [interval, setInterval] = useState<BillingInterval>('monthly')
  const [prices, setPrices] = useState<PriceData | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState<'pro' | 'team' | 'startup' | null>(null)
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
        const [priceData, subData] = await Promise.all([
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
        ])
        if (priceData) setPrices(priceData)
        if (subData) setSubscription(subData)
      } catch (error) {
        console.error('Failed to fetch pricing data:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const handleCheckout = async (priceId: string, plan: 'pro' | 'team' | 'startup') => {
    trackEvent(AnalyticsEvents.UPGRADE_CLICK, {
      plan,
      interval,
    })
    setCheckoutLoading(plan)
    try {
      const successUrl = `${window.location.origin}/dashboard/settings?upgraded=true`
      const cancelUrl = window.location.href
      const { url } = await api.createCheckoutSession(priceId, successUrl, cancelUrl)
      window.location.href = url
    } catch (error) {
      console.error('Failed to create checkout session:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to start checkout. Please try again.')
      setCheckoutLoading(null)
    }
  }

  const handleIntervalChange = (newInterval: BillingInterval) => {
    if (newInterval !== interval) {
      trackEvent(AnalyticsEvents.UPGRADE_INTERVAL_CHANGE, {
        from: interval,
        to: newInterval,
      })
      setInterval(newInterval)
    }
  }

  const getProPrice = () => {
    if (!prices) return { display: '$4', monthly: 4 }
    const priceObj = interval === 'monthly' ? prices.prices.pro.monthly : prices.prices.pro.yearly
    const amount = priceObj.price / 100 // Convert cents to dollars
    if (interval === 'yearly') {
      const monthly = Math.round(amount / 12)
      return { display: `$${monthly}`, monthly, yearly: amount }
    }
    return { display: `$${amount}`, monthly: amount }
  }

  const getProPriceId = () => {
    if (!prices) return null
    return interval === 'monthly' ? prices.prices.pro.monthly.id : prices.prices.pro.yearly.id
  }

  const getTeamPrice = () => {
    if (!prices || !prices.prices.team) return { display: '$15', monthly: 15 }
    const priceObj = interval === 'monthly' ? prices.prices.team.monthly : prices.prices.team.yearly
    const amount = priceObj.price / 100 // Convert cents to dollars
    if (interval === 'yearly') {
      const monthly = Math.round(amount / 12)
      return { display: `$${monthly}`, monthly, yearly: amount }
    }
    return { display: `$${amount}`, monthly: amount }
  }

  const getTeamPriceId = () => {
    if (!prices || !prices.prices.team) return null
    return interval === 'monthly' ? prices.prices.team.monthly.id : prices.prices.team.yearly.id
  }

  const getStartupPrice = () => {
    if (!prices || !prices.prices.startup) return { display: '$39', monthly: 39 }
    const priceObj = interval === 'monthly' ? prices.prices.startup.monthly : prices.prices.startup.yearly
    const amount = priceObj.price / 100 // Convert cents to dollars
    if (interval === 'yearly') {
      const monthly = Math.round(amount / 12)
      return { display: `$${monthly}`, monthly, yearly: amount }
    }
    return { display: `$${amount}`, monthly: amount }
  }

  const getStartupPriceId = () => {
    if (!prices || !prices.prices.startup) return null
    return interval === 'monthly' ? prices.prices.startup.monthly.id : prices.prices.startup.yearly.id
  }

  const proPrice = getProPrice()
  const proPriceId = getProPriceId()
  const teamPrice = getTeamPrice()
  const teamPriceId = getTeamPriceId()
  const startupPrice = getStartupPrice()
  const startupPriceId = getStartupPriceId()

  // Check current subscription status
  // Consider 'active' and 'trialing' as having an active subscription
  const isSubscriptionActive = subscription?.billingStatus === 'active' || subscription?.billingStatus === 'trialing'
  const hasActiveSubscription = isSubscriptionActive && subscription?.plan !== 'free'
  const isCurrentPlanPro = subscription?.plan === 'pro' && isSubscriptionActive
  const isCurrentPlanTeam = subscription?.plan === 'team' && isSubscriptionActive
  const isCurrentPlanStartup = subscription?.plan === 'startup' && isSubscriptionActive
  const isCurrentPlanFree = !subscription || subscription.plan === 'free' || subscription.billingStatus === 'canceled'

  // Disable upgrade buttons if user has any active paid subscription
  const canUpgrade = !hasActiveSubscription

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
              href="/dashboard"
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
              Unlock unlimited vaults and more features for your team.
            </p>
          </div>

          {/* Active subscription banner */}
          {hasActiveSubscription && (
            <div className="mb-8 p-4 rounded-lg bg-primary/10 border border-primary/30 text-center">
              <p className="text-primary mb-2">
                You already have an active <span className="font-semibold capitalize">{subscription?.plan}</span> subscription.
              </p>
              <Link
                href="/dashboard/settings"
                className="text-sm text-primary/80 hover:text-primary underline"
              >
                Manage your subscription in Settings
              </Link>
            </div>
          )}

          {/* Billing toggle */}
          <div className="flex justify-center mb-12">
            <div className="bg-gray-900 p-1 rounded-lg inline-flex">
              <button
                onClick={() => handleIntervalChange('monthly')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  interval === 'monthly'
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => handleIntervalChange('yearly')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  interval === 'yearly'
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Yearly
                <span className="ml-2 text-xs text-primary">Save 17%</span>
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          ) : (
            <>
              {/* Plans grid */}
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                {/* Free Plan */}
                <div className="rounded-2xl p-6 bg-gray-900 border border-gray-800">
                  <h2 className="text-xl font-bold text-white mb-1">Free</h2>
                  <p className="text-gray-400 text-sm mb-4">For personal projects</p>
                  <div className="mb-6">
                    <span className="text-3xl font-bold text-white">$0</span>
                    <span className="text-gray-400">/month</span>
                  </div>
                  <ul className="space-y-3 mb-6">
                    {planFeatures.free.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm">
                        <CheckIcon className="w-5 h-5 text-primary shrink-0" />
                        <span className="text-gray-300">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  {isCurrentPlanFree ? (
                    <div className="w-full py-2 px-4 rounded-lg bg-gray-800 text-gray-400 text-center text-sm">
                      Current plan
                    </div>
                  ) : (
                    <div className="w-full py-2 px-4 rounded-lg bg-gray-800 text-gray-400 text-center text-sm">
                      Free tier
                    </div>
                  )}
                </div>

                {/* Pro Plan */}
                <div className="rounded-2xl p-6 bg-primary/10 border-2 border-primary">
                  <div className="text-primary text-sm font-medium mb-2">Most popular</div>
                  <h2 className="text-xl font-bold text-white mb-1">Pro</h2>
                  <p className="text-gray-400 text-sm mb-4">For professionals & small teams</p>
                  <div className="mb-6">
                    <span className="text-3xl font-bold text-white">{proPrice.display}</span>
                    <span className="text-gray-400">/month</span>
                    {interval === 'yearly' && proPrice.yearly && (
                      <div className="text-sm text-gray-500 mt-1">
                        Billed ${proPrice.yearly}/year
                      </div>
                    )}
                  </div>
                  <ul className="space-y-3 mb-6">
                    {planFeatures.pro.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm">
                        <CheckIcon className="w-5 h-5 text-primary shrink-0" />
                        <span className="text-gray-300">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  {isCurrentPlanPro ? (
                    <div className="w-full py-2 px-4 rounded-lg bg-gray-800 text-gray-400 text-center text-sm">
                      Current plan
                    </div>
                  ) : !canUpgrade ? (
                    <Link
                      href="/dashboard/settings"
                      className="block w-full py-2 px-4 rounded-lg text-center text-sm font-medium transition-colors bg-gray-800 text-gray-400 hover:bg-gray-700"
                    >
                      Manage in Settings
                    </Link>
                  ) : isLoggedIn === false ? (
                    <Link
                      href="/login?redirect=/upgrade"
                      className="block w-full py-2 px-4 rounded-lg text-center text-sm font-medium transition-colors bg-primary hover:bg-primary/90 text-white"
                    >
                      Login to upgrade
                    </Link>
                  ) : proPriceId && isLoggedIn ? (
                    <button
                      onClick={() => handleCheckout(proPriceId, 'pro')}
                      disabled={checkoutLoading !== null}
                      className="block w-full py-2 px-4 rounded-lg text-center text-sm font-medium transition-colors bg-primary hover:bg-primary/90 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {checkoutLoading === 'pro' ? (
                        <Loader2 className="w-4 h-4 mx-auto animate-spin" />
                      ) : (
                        `Upgrade to Pro`
                      )}
                    </button>
                  ) : (
                    <a
                      href={`mailto:${contactEmail}?subject=Upgrade to Pro`}
                      className="block w-full py-2 px-4 rounded-lg text-center text-sm font-medium transition-colors bg-primary hover:bg-primary/90 text-white"
                    >
                      Contact us to upgrade
                    </a>
                  )}
                </div>

                {/* Team Plan */}
                <div className="rounded-2xl p-6 bg-gray-900 border border-gray-800">
                  <div className="text-purple-400 text-sm font-medium mb-2">Collaboration</div>
                  <h2 className="text-xl font-bold text-white mb-1">Team</h2>
                  <p className="text-gray-400 text-sm mb-4">Audit logs & access control</p>
                  <div className="mb-6">
                    <span className="text-3xl font-bold text-white">{teamPrice.display}</span>
                    <span className="text-gray-400">/month</span>
                    {interval === 'yearly' && teamPrice.yearly && (
                      <div className="text-sm text-gray-500 mt-1">
                        Billed ${teamPrice.yearly}/year
                      </div>
                    )}
                  </div>
                  <ul className="space-y-3 mb-6">
                    {planFeatures.team.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm">
                        <CheckIcon className="w-5 h-5 text-primary shrink-0" />
                        <span className="text-gray-300">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  {isCurrentPlanTeam ? (
                    <div className="w-full py-2 px-4 rounded-lg bg-gray-800 text-gray-400 text-center text-sm">
                      Current plan
                    </div>
                  ) : !canUpgrade ? (
                    <Link
                      href="/dashboard/settings"
                      className="block w-full py-2 px-4 rounded-lg text-center text-sm font-medium transition-colors bg-gray-800 text-gray-400 hover:bg-gray-700"
                    >
                      Manage in Settings
                    </Link>
                  ) : isLoggedIn === false ? (
                    <Link
                      href="/login?redirect=/upgrade"
                      className="block w-full py-2 px-4 rounded-lg text-center text-sm font-medium transition-colors bg-purple-600 hover:bg-purple-700 text-white"
                    >
                      Login to upgrade
                    </Link>
                  ) : teamPriceId && isLoggedIn ? (
                    <button
                      onClick={() => handleCheckout(teamPriceId, 'team')}
                      disabled={checkoutLoading !== null}
                      className="block w-full py-2 px-4 rounded-lg text-center text-sm font-medium transition-colors bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {checkoutLoading === 'team' ? (
                        <Loader2 className="w-4 h-4 mx-auto animate-spin" />
                      ) : (
                        `Upgrade to Team`
                      )}
                    </button>
                  ) : (
                    <a
                      href={`mailto:${contactEmail}?subject=Upgrade to Team`}
                      className="block w-full py-2 px-4 rounded-lg text-center text-sm font-medium transition-colors bg-purple-600 hover:bg-purple-700 text-white"
                    >
                      Contact us to upgrade
                    </a>
                  )}
                </div>

                {/* Startup Plan */}
                <div className="rounded-2xl p-6 bg-gray-900 border border-gray-800">
                  <div className="text-amber-400 text-sm font-medium mb-2">Best value</div>
                  <h2 className="text-xl font-bold text-white mb-1">Startup</h2>
                  <p className="text-gray-400 text-sm mb-4">40 repos & priority support</p>
                  <div className="mb-6">
                    <span className="text-3xl font-bold text-white">{startupPrice.display}</span>
                    <span className="text-gray-400">/month</span>
                    {interval === 'yearly' && startupPrice.yearly && (
                      <div className="text-sm text-gray-500 mt-1">
                        Billed ${startupPrice.yearly}/year
                      </div>
                    )}
                  </div>
                  <ul className="space-y-3 mb-6">
                    {planFeatures.startup.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm">
                        <CheckIcon className="w-5 h-5 text-primary shrink-0" />
                        <span className="text-gray-300">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  {isCurrentPlanStartup ? (
                    <div className="w-full py-2 px-4 rounded-lg bg-gray-800 text-gray-400 text-center text-sm">
                      Current plan
                    </div>
                  ) : !canUpgrade ? (
                    <Link
                      href="/dashboard/settings"
                      className="block w-full py-2 px-4 rounded-lg text-center text-sm font-medium transition-colors bg-gray-800 text-gray-400 hover:bg-gray-700"
                    >
                      Manage in Settings
                    </Link>
                  ) : isLoggedIn === false ? (
                    <Link
                      href="/login?redirect=/upgrade"
                      className="block w-full py-2 px-4 rounded-lg text-center text-sm font-medium transition-colors bg-amber-600 hover:bg-amber-700 text-white"
                    >
                      Login to upgrade
                    </Link>
                  ) : startupPriceId && isLoggedIn ? (
                    <button
                      onClick={() => handleCheckout(startupPriceId, 'startup')}
                      disabled={checkoutLoading !== null}
                      className="block w-full py-2 px-4 rounded-lg text-center text-sm font-medium transition-colors bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {checkoutLoading === 'startup' ? (
                        <Loader2 className="w-4 h-4 mx-auto animate-spin" />
                      ) : (
                        `Upgrade to Startup`
                      )}
                    </button>
                  ) : (
                    <a
                      href={`mailto:${contactEmail}?subject=Upgrade to Startup`}
                      className="block w-full py-2 px-4 rounded-lg text-center text-sm font-medium transition-colors bg-amber-600 hover:bg-amber-700 text-white"
                    >
                      Contact us to upgrade
                    </a>
                  )}
                </div>
              </div>

              {/* FAQ / Info section */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
                <p className="text-gray-400 mb-2">
                  Secure payments powered by Stripe
                </p>
                <p className="text-gray-500 text-sm mb-2">
                  Plans are per-account. Organizations are billed separately.
                </p>
                <p className="text-gray-500 text-sm">
                  Cancel anytime. Questions?{' '}
                  <a href={`mailto:${contactEmail}`} className="text-primary hover:underline">
                    Contact us
                  </a>
                </p>
              </div>
            </>
          )}
        </div>
      </main>

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
