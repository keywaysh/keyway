'use client'

import { Clock, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import Link from 'next/link'
import type { TrialInfo } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface TrialBannerProps {
  trial: TrialInfo
  orgLogin: string
  className?: string
  dismissable?: boolean
}

export function TrialBanner({ trial, orgLogin, className, dismissable = true }: TrialBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || trial.status !== 'active') {
    return null
  }

  const daysRemaining = trial.days_remaining ?? 0
  const isUrgent = daysRemaining <= 3
  const isLastDay = daysRemaining <= 1

  return (
    <div
      className={cn(
        'relative flex items-center justify-between gap-4 px-4 py-3 rounded-lg',
        isLastDay
          ? 'bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400'
          : isUrgent
          ? 'bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400'
          : 'bg-primary/10 border border-primary/20 text-primary',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn(
          'flex items-center justify-center h-8 w-8 rounded-full',
          isLastDay
            ? 'bg-red-500/20'
            : isUrgent
            ? 'bg-amber-500/20'
            : 'bg-primary/20'
        )}>
          <Clock className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-medium">
            {isLastDay
              ? 'Last day of your Team trial!'
              : isUrgent
              ? `Only ${daysRemaining} days left in your Team trial`
              : `${daysRemaining} days remaining in your Team trial`
            }
          </p>
          <p className="text-xs opacity-80">
            {isLastDay
              ? 'Upgrade now to keep all Team features'
              : 'Upgrade to keep unlimited repos, environments, and secrets'
            }
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          asChild
          size="sm"
          className={cn(
            isLastDay
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : isUrgent
              ? 'bg-amber-500 hover:bg-amber-600 text-white'
              : ''
          )}
        >
          <Link href={`/orgs/${orgLogin}/billing`}>
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Upgrade Now
          </Link>
        </Button>

        {dismissable && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 opacity-60 hover:opacity-100"
            onClick={() => setDismissed(true)}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Dismiss</span>
          </Button>
        )}
      </div>
    </div>
  )
}

interface TrialExpiredBannerProps {
  orgLogin: string
  className?: string
}

export function TrialExpiredBanner({ orgLogin, className }: TrialExpiredBannerProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 px-4 py-3 rounded-lg',
        'bg-muted border border-border',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted-foreground/20">
          <Clock className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Your Team trial has ended</p>
          <p className="text-xs text-muted-foreground">
            Upgrade to restore unlimited repos, environments, and secrets
          </p>
        </div>
      </div>

      <Button asChild size="sm">
        <Link href={`/orgs/${orgLogin}/billing`}>
          <Sparkles className="h-3.5 w-3.5 mr-1.5" />
          Upgrade to Team
        </Link>
      </Button>
    </div>
  )
}
