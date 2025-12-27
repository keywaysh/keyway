'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { PartyPopper, Terminal, Users, X } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface OnboardingBannerProps {
  orgLogin: string
}

export function OnboardingBanner({ orgLogin }: OnboardingBannerProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [isDismissed, setIsDismissed] = useState<boolean | null>(null) // null = not yet checked

  // Check if we should show the banner (only when welcome=true is in URL)
  const showWelcome = searchParams.get('welcome') === 'true'

  // Check localStorage for persistent dismissal (runs on client only)
  useEffect(() => {
    const dismissed = localStorage.getItem(`keyway_org_onboarding_${orgLogin}`)
    setIsDismissed(dismissed === 'true')
  }, [orgLogin])

  // Don't render until we've checked localStorage (prevents hydration mismatch)
  // Also don't render if welcome param is not present or if dismissed
  if (!showWelcome || isDismissed === null || isDismissed) {
    return null
  }

  const handleDismiss = () => {
    setIsDismissed(true)
    localStorage.setItem(`keyway_org_onboarding_${orgLogin}`, 'true')
    // Remove the welcome query param
    router.replace(pathname, { scroll: false })
  }

  return (
    <Card className="bg-linear-to-r from-green-500/10 via-emerald-500/10 to-teal-500/10 border-green-500/20">
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <div className="flex items-center justify-center h-10 w-10 rounded-full bg-green-500/20 shrink-0">
            <PartyPopper className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-green-800 dark:text-green-200">
              Welcome to {orgLogin} on Keyway!
            </h3>
            <p className="text-sm text-green-700/80 dark:text-green-300/80 mt-1">
              Your organization is now connected. Here are some next steps to get started:
            </p>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-start gap-2.5 text-sm">
                <Terminal className="h-4 w-4 mt-0.5 text-green-600 dark:text-green-400 shrink-0" />
                <div>
                  <span className="font-medium text-green-800 dark:text-green-200">Create your first vault</span>
                  <p className="text-green-700/70 dark:text-green-300/70 text-xs mt-0.5">
                    Run <code className="px-1 py-0.5 rounded bg-green-500/10 font-mono">keyway init</code> in one of your org repos
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2.5 text-sm">
                <Users className="h-4 w-4 mt-0.5 text-green-600 dark:text-green-400 shrink-0" />
                <div>
                  <span className="font-medium text-green-800 dark:text-green-200">Invite your team</span>
                  <p className="text-green-700/70 dark:text-green-300/70 text-xs mt-0.5">
                    Team members with repo access can use Keyway automatically
                  </p>
                </div>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-8 w-8 text-green-600 hover:text-green-800 hover:bg-green-500/10 dark:text-green-400 dark:hover:text-green-200"
            onClick={handleDismiss}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Dismiss</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
