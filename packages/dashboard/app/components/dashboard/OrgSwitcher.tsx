'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { ChevronsUpDown, Building2, User, Check, Sparkles } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { Organization } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'

// Storage key for persisting selected context
const CONTEXT_KEY = 'keyway_org_context'

export type OrgContext = {
  type: 'personal'
  id: null
  login: null
} | {
  type: 'organization'
  id: string
  login: string
}

function getStoredContext(): OrgContext | null {
  if (typeof window === 'undefined') return null
  const stored = localStorage.getItem(CONTEXT_KEY)
  if (!stored) return null
  try {
    return JSON.parse(stored)
  } catch {
    return null
  }
}

function setStoredContext(ctx: OrgContext) {
  if (typeof window === 'undefined') return
  localStorage.setItem(CONTEXT_KEY, JSON.stringify(ctx))
}

interface OrgSwitcherProps {
  onContextChange?: (ctx: OrgContext) => void
  className?: string
}

export function OrgSwitcher({ onContextChange, className }: OrgSwitcherProps) {
  const { user } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [isLoading, setIsLoading] = useState(true)
  // Lazy initialization: read from localStorage only once
  const [context, setContext] = useState<OrgContext>(() => getStoredContext() ?? { type: 'personal', id: null, login: null })
  const [isOpen, setIsOpen] = useState(false)

  // Load organizations on mount (only once)
  useEffect(() => {
    async function loadOrgs() {
      try {
        const orgs = await api.getOrganizations()
        setOrganizations(orgs)

        // Validate stored context still exists
        const stored = getStoredContext()
        if (stored?.type === 'organization') {
          const exists = orgs.some(o => o.id === stored.id)
          if (!exists) {
            const fallback: OrgContext = { type: 'personal', id: null, login: null }
            setContext(fallback)
            setStoredContext(fallback)
          }
        }
      } catch (err) {
        console.error('Failed to load organizations:', err)
      } finally {
        setIsLoading(false)
      }
    }
    loadOrgs()
  }, [])

  // Detect context from URL (separate from data loading)
  useEffect(() => {
    if (organizations.length === 0) return

    const urlOrgMatch = pathname.match(/\/orgs\/([^/]+)/)
    if (urlOrgMatch) {
      const orgLogin = urlOrgMatch[1]
      const org = organizations.find(o => o.login === orgLogin)
      if (org && context.login !== orgLogin) {
        const ctx: OrgContext = { type: 'organization', id: org.id, login: org.login }
        setContext(ctx)
        setStoredContext(ctx)
        onContextChange?.(ctx)
      }
    }
  }, [pathname, organizations, context.login])

  const handleSelect = (ctx: OrgContext) => {
    setContext(ctx)
    setStoredContext(ctx)
    setIsOpen(false)
    onContextChange?.(ctx)

    trackEvent(AnalyticsEvents.ORG_SWITCH, {
      type: ctx.type,
      org: ctx.type === 'organization' ? ctx.login : null,
    })

    // Navigate based on context
    if (ctx.type === 'organization') {
      router.push(`/orgs/${ctx.login}`)
    } else {
      router.push('/')
    }
  }

  const currentDisplay = context.type === 'organization'
    ? organizations.find(o => o.id === context.id)
    : null

  if (isLoading) {
    return (
      <div className={cn('px-3 py-2 border-b border-border', className)}>
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
    )
  }

  // Don't show switcher if no organizations
  if (organizations.length === 0) {
    return null
  }

  return (
    <div className={cn('px-3 py-2 border-b border-border', className)}>
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50 transition-colors text-left"
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {context.type === 'personal' ? (
              <>
                <Avatar className="size-8 ring-1 ring-border">
                  <AvatarImage src={user?.avatar_url} alt={user?.name} />
                  <AvatarFallback>
                    <User className="size-4" />
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">
                    {user?.name || user?.github_username || 'Personal'}
                  </div>
                  <div className="text-xs text-muted-foreground">Personal account</div>
                </div>
              </>
            ) : currentDisplay ? (
              <>
                <Avatar className="size-8 ring-1 ring-border">
                  <AvatarImage src={currentDisplay.avatar_url} alt={currentDisplay.display_name} />
                  <AvatarFallback>
                    <Building2 className="size-4" />
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">
                      {currentDisplay.display_name || currentDisplay.login}
                    </span>
                    {currentDisplay.plan === 'team' && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Team</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">Organization</div>
                </div>
              </>
            ) : (
              <span className="text-muted-foreground">Select context</span>
            )}
          </div>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          Personal Account
        </DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => handleSelect({ type: 'personal', id: null, login: null })}
          className="cursor-pointer"
        >
          <Avatar className="h-5 w-5 mr-2">
            <AvatarImage src={user?.avatar_url} alt={user?.name} />
            <AvatarFallback>
              <User className="h-2.5 w-2.5" />
            </AvatarFallback>
          </Avatar>
          <span className="truncate flex-1">{user?.name || 'Personal'}</span>
          {context.type === 'personal' && (
            <Check className="h-4 w-4 ml-auto" />
          )}
        </DropdownMenuItem>

        {organizations.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
              Organizations
            </DropdownMenuLabel>
            {organizations.map((org) => (
              <DropdownMenuItem
                key={org.id}
                onClick={() => handleSelect({ type: 'organization', id: org.id, login: org.login })}
                className="cursor-pointer"
              >
                <Avatar className="h-5 w-5 mr-2">
                  <AvatarImage src={org.avatar_url} alt={org.display_name} />
                  <AvatarFallback>
                    <Building2 className="h-2.5 w-2.5" />
                  </AvatarFallback>
                </Avatar>
                <span className="truncate flex-1">{org.display_name || org.login}</span>
                <div className="flex items-center gap-1.5 ml-auto">
                  {org.plan === 'team' ? (
                    <Badge variant="secondary" className="text-xs px-1.5 py-0">Team</Badge>
                  ) : (
                    <span title="Start trial">
                      <Sparkles className="h-3 w-3 text-muted-foreground" />
                    </span>
                  )}
                  {context.type === 'organization' && context.id === org.id && (
                    <Check className="h-4 w-4" />
                  )}
                </div>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    </div>
  )
}

export function OrgSwitcherSkeleton() {
  return (
    <div className="px-3 py-2 border-b border-border">
      <div className="flex items-center gap-3 p-2">
        <Skeleton className="size-8 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-4 w-24 mb-1" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
    </div>
  )
}
