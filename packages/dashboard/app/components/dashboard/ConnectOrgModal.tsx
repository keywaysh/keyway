'use client'

import { useState, useEffect, useCallback } from 'react'
import { Building2, ExternalLink, Loader2, AlertCircle } from 'lucide-react'
import Image from 'next/image'
import { api } from '@/lib/api'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ConnectOrgModalProps {
  isOpen: boolean
  onClose: () => void
  onConnect: (orgLogin: string) => Promise<void>
}

export function ConnectOrgModal({
  isOpen,
  onClose,
}: ConnectOrgModalProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [installUrl, setInstallUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchInstallUrl = useCallback(async () => {
    try {
      const response = await api.getAvailableOrganizations()
      setInstallUrl(response.install_url)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      trackEvent(AnalyticsEvents.ORG_CONNECT_MODAL_OPEN)
      setIsLoading(true)
      fetchInstallUrl()
    }
  }, [isOpen, fetchInstallUrl])

  const handleInstallClick = () => {
    trackEvent(AnalyticsEvents.ORG_APP_INSTALL_CLICK)
  }

  const steps = [
    'Click the button below',
    'Select your organization on GitHub',
    'Choose which repositories to enable',
    "You'll be redirected back automatically",
  ]

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="size-5" />
            Connect an Organization
          </DialogTitle>
          <DialogDescription>
            Install Keyway on your GitHub organization to sync secrets across your team.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" />
              {error}
            </div>
          )}

          {/* GIF placeholder - replace src with actual GIF */}
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-muted">
            <Image
              src="/images/github-app-install.gif"
              alt="How to install Keyway GitHub App"
              fill
              className="object-cover"
              unoptimized
            />
          </div>

          {/* Steps */}
          <ol className="space-y-2 text-sm text-muted-foreground">
            {steps.map((step, index) => (
              <li key={index} className="flex items-start gap-3">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          {/* CTA Button */}
          {isLoading ? (
            <Button disabled className="w-full">
              <Loader2 className="size-4 mr-2 animate-spin" />
              Loading...
            </Button>
          ) : installUrl ? (
            <Button asChild className="w-full">
              <a
                href={installUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleInstallClick}
              >
                Install Keyway GitHub App
                <ExternalLink className="size-4 ml-2" />
              </a>
            </Button>
          ) : (
            <Button disabled className="w-full">
              Unable to load install link
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
