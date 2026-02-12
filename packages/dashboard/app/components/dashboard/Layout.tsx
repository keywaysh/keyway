'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { LoadingSpinner } from './LoadingSpinner'
import { AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import * as Sentry from '@sentry/nextjs'

interface LayoutProps {
  children: ReactNode
}

const SIDEBAR_COLLAPSED_KEY = 'keyway_sidebar_collapsed'

// Clear session cookies
function clearSessionCookies() {
  const hostname = window.location.hostname
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1'
  if (isLocalhost) {
    document.cookie = 'keyway_logged_in=; Path=/; Max-Age=0'
    document.cookie = 'keyway_session=; Path=/; Max-Age=0'
  } else {
    // Derive cookie domain from hostname:
    // - .local domains (e.g., "app.keyway.local" -> "keyway.local")
    // - production domains (e.g., "app.keyway.sh" -> ".keyway.sh")
    const parts = hostname.split('.')
    const isLocalDomain = hostname.endsWith('.local')
    const cookieDomain = isLocalDomain
      ? parts.slice(-2).join('.')
      : parts.length >= 2 ? '.' + parts.slice(-2).join('.') : hostname
    document.cookie = `keyway_logged_in=; Path=/; Domain=${cookieDomain}; Max-Age=0`
    document.cookie = `keyway_session=; Path=/; Domain=${cookieDomain}; Max-Age=0`
  }
}

export function DashboardLayout({ children }: LayoutProps) {
  const { user, isLoading, error } = useAuth()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [countdown, setCountdown] = useState(5)

  // Load collapsed state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    if (saved === 'true') {
      setSidebarCollapsed(true)
    }
  }, [])

  const handleToggleCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const newValue = !prev
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(newValue))
      return newValue
    })
  }

  useEffect(() => {
    // Only redirect if not loading, no user, AND no error
    // (error means backend issue, not "not logged in")
    if (!isLoading && !user && !error) {
      router.push('/login')
    }
  }, [isLoading, user, error, router])

  // Handle session error: clear cookies and redirect after countdown
  useEffect(() => {
    if (!error) return

    // Report to Sentry
    Sentry.captureMessage('Session expired or invalid', {
      level: 'warning',
      tags: { type: 'session_error' },
      extra: { error },
    })

    // Clear cookies immediately
    clearSessionCookies()

    // Start countdown
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          window.location.href = '/'
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [error])

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <LoadingSpinner />
      </div>
    )
  }

  // Show error state if backend is down or returned an error
  if (error) {
    return (
      <div className="min-h-dvh bg-muted flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground mb-1">
                  Session expired
                </h2>
                <p className="text-sm text-muted-foreground">
                  Your session has expired. Redirecting to home in {countdown}s...
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  If this problem persists, contact us at{' '}
                  <a href={`mailto:${process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'hello@keyway.sh'}`} className="underline hover:text-foreground">
                    {process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'hello@keyway.sh'}
                  </a>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="h-dvh bg-muted flex overflow-hidden">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isCollapsed={sidebarCollapsed}
        onToggleCollapsed={handleToggleCollapsed}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-3 sm:p-4 md:p-6 overflow-y-auto min-h-0">
          {children}
        </main>
      </div>
    </div>
  )
}
