'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useState } from 'react'

// Exponential backoff: 1s, 2s, 4s (capped at 30s)
const getRetryDelay = (attemptIndex: number) =>
  Math.min(1000 * 2 ** attemptIndex, 30000)

// Only retry on network errors or 5xx, not on 4xx (client errors)
const shouldRetry = (failureCount: number, error: unknown) => {
  if (failureCount >= 2) return false
  if (error instanceof Error) {
    // Don't retry 4xx errors (client errors like 401, 403, 404)
    const message = error.message.toLowerCase()
    if (
      message.includes('401') ||
      message.includes('403') ||
      message.includes('404') ||
      message.includes('400') ||
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      message.includes('not found')
    ) {
      return false
    }
  }
  return true
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Stale time of 1 minute - data considered fresh for 1 min
            staleTime: 60 * 1000,
            // Retry with exponential backoff
            retry: shouldRetry,
            retryDelay: getRetryDelay,
            // Refetch on window focus for fresh data
            refetchOnWindowFocus: true,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}
