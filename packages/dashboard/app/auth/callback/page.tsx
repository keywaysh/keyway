'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'

const errorMessages: Record<string, string> = {
  access_denied: 'Access was denied. Please try again.',
  invalid_state: 'Authentication failed due to an invalid or expired session. Please try again.',
  invalid_request: 'The authentication request was invalid. Please try again.',
  server_error: 'An unexpected error occurred. Please try again later.',
  temporarily_unavailable: 'The service is temporarily unavailable. Please try again later.',
}

function AuthCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const errorParam = searchParams.get('error')

    if (errorParam) {
      // Only send known error codes to analytics — raw param is user-controlled
      const normalizedError = errorParam in errorMessages ? errorParam : 'unknown'
      trackEvent(AnalyticsEvents.AUTH_CALLBACK_ERROR, { error: normalizedError })
      setError(errorMessages[errorParam] || 'An unexpected error occurred. Please try again.')
      return
    }

    // Session cookie is set by the backend, redirect to home
    trackEvent(AnalyticsEvents.AUTH_CALLBACK_SUCCESS)
    router.push('/')
  }, [searchParams, router])

  if (error) {
    return (
      <div className="min-h-dvh bg-dark-darker flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-red-500/10 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold mb-2">Authentication failed</h1>
          <p className="text-gray-muted mb-6">{error}</p>
          <a
            href="/login"
            className="inline-flex items-center justify-center px-4 py-2 bg-primary text-dark font-semibold rounded-lg hover:bg-primary-strong transition-colors"
          >
            Try again
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-dark-darker flex items-center justify-center p-4">
      <div className="text-center">
        <div className="w-6 h-6 mx-auto border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-4" />
        <p className="text-gray-muted">Signing you in...</p>
      </div>
    </div>
  )
}

function LoadingFallback() {
  return (
    <div className="min-h-dvh bg-dark-darker flex items-center justify-center p-4">
      <div className="text-center">
        <div className="w-6 h-6 mx-auto border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-4" />
        <p className="text-gray-muted">Loading...</p>
      </div>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <AuthCallbackContent />
    </Suspense>
  )
}
