'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AlertTriangle, RefreshCcw, Home } from 'lucide-react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Dashboard error:', error)
  }, [error])

  return (
    <div className="container max-w-2xl py-16">
      <Card>
        <CardContent className="pt-6">
          <div className="text-center space-y-6">
            <div className="flex justify-center">
              <div className="rounded-full bg-destructive/10 p-4">
                <AlertTriangle className="h-10 w-10 text-destructive" />
              </div>
            </div>

            <div className="space-y-2">
              <h1 className="text-xl font-semibold">
                Something went wrong
              </h1>
              <p className="text-sm text-muted-foreground">
                We could not load this page. Please try again.
              </p>
            </div>

            <div className="flex gap-3 justify-center">
              <Button onClick={reset} size="sm" className="gap-2">
                <RefreshCcw className="h-4 w-4" />
                Try again
              </Button>
              <Button
                onClick={() => window.location.href = '/'}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <Home className="h-4 w-4" />
                Dashboard
              </Button>
            </div>

            {process.env.NODE_ENV === 'development' && error.message && (
              <div className="mt-4 p-3 bg-muted rounded text-left">
                <p className="text-xs font-mono text-muted-foreground break-all">
                  {error.message}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
