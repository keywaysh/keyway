'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth, AuthProvider } from '@/lib/auth'
import { KeywayLogo } from '@/app/components/logo'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import { API_BASE } from '@/lib/env'

function LoginContentInner() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loginUrl, setLoginUrl] = useState(`${API_BASE}/v1/auth/github/start`)

  // Get redirect path from query params, default to /
  // Security: Only allow relative paths starting with / to prevent open redirect attacks
  const rawRedirect = searchParams.get('redirect') || '/'
  const redirectPath = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//')
    ? rawRedirect
    : '/'

  useEffect(() => {
    trackEvent(AnalyticsEvents.LOGIN_PAGE_VIEW)
    const redirectUri = encodeURIComponent(window.location.origin + redirectPath)
    setLoginUrl(`${API_BASE}/v1/auth/github/start?redirect_uri=${redirectUri}`)
  }, [redirectPath])

  useEffect(() => {
    if (!isLoading && user) {
      router.push(redirectPath)
    }
  }, [isLoading, user, router, redirectPath])

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  if (user) {
    return null
  }

  return (
    <div className="min-h-dvh bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 font-extrabold text-xl tracking-tight text-gray-900 dark:text-white mb-4">
            <KeywayLogo className="w-6 h-6 text-primary" />
            <span>Keyway</span>
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Welcome back</h1>
          <p className="text-gray-500 dark:text-gray-400">Sign in to manage your secrets</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow ring-1 ring-gray-900/5 dark:ring-white/10 p-6">
          <a
            href={loginUrl}
            onClick={() => trackEvent(AnalyticsEvents.LOGIN_GITHUB_CLICK)}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-semibold rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            Sign in with GitHub
          </a>

          <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              By signing in, you agree to our{' '}
              <a href={`${process.env.NEXT_PUBLIC_LANDING_URL || 'https://keyway.sh'}/terms`} className="text-primary hover:underline">
                Terms of Service
              </a>
            </p>
          </div>
        </div>

        <p className="text-center mt-6 text-sm text-gray-500 dark:text-gray-400">
          New to Keyway?{' '}
          <a href={process.env.NEXT_PUBLIC_LANDING_URL || 'https://keyway.sh'} className="text-primary hover:underline">
            Learn more
          </a>
        </p>
      </div>
    </div>
  )
}

// Wrapper with Suspense boundary for useSearchParams (required by Next.js 15)
function LoginContent() {
  return (
    <Suspense fallback={
      <div className="min-h-dvh bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    }>
      <LoginContentInner />
    </Suspense>
  )
}

export default function LoginPage() {
  return (
    <AuthProvider>
      <LoginContent />
    </AuthProvider>
  )
}
