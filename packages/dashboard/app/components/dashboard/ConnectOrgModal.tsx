'use client'

import { useState, useEffect, useCallback } from 'react'
import { Building2, ExternalLink, Loader2, AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import type { AvailableOrg } from '@/lib/types'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'

interface ConnectOrgModalProps {
  isOpen: boolean
  onClose: () => void
  onConnect: (orgLogin: string) => Promise<void>
}

export function ConnectOrgModal({ isOpen, onClose, onConnect }: ConnectOrgModalProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [orgs, setOrgs] = useState<AvailableOrg[]>([])
  const [installUrl, setInstallUrl] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchAvailable = useCallback(async () => {
    try {
      const response = await api.getAvailableOrganizations()
      setOrgs(response.organizations)
      setInstallUrl(response.install_url)
      setError(null)
    } catch (err) {
      // Clear stale data so a failed reopen/retry doesn't show old orgs/install URL.
      setOrgs([])
      setInstallUrl(null)
      setError(err instanceof Error ? err.message : 'Failed to load organizations')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      trackEvent(AnalyticsEvents.ORG_CONNECT_MODAL_OPEN)
      setIsLoading(true)
      fetchAvailable()
    }
  }, [isOpen, fetchAvailable])

  const handleConnect = async (login: string) => {
    setConnecting(login)
    setError(null)
    try {
      // onConnect (page handler) calls POST /v1/orgs/connect, which creates the
      // org + the caller's membership without waiting on a webhook.
      await onConnect(login)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect organization')
    } finally {
      setConnecting(null)
    }
  }

  const handleInstallClick = () => {
    trackEvent(AnalyticsEvents.ORG_APP_INSTALL_CLICK)
  }

  // Orgs the user can connect now: app installed, GitHub access, not yet in Keyway.
  const connectable = orgs.filter((o) => o.status === 'ready' && !o.already_connected)

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="size-5" />
            Connect an Organization
          </DialogTitle>
          <DialogDescription>
            Connect a GitHub organization where the Keyway app is installed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" />
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (
            <>
              {connectable.length > 0 ? (
                <div className="space-y-2">
                  {connectable.map((org) => (
                    <div
                      key={org.login}
                      className="flex items-center gap-3 rounded-lg border border-border p-3"
                    >
                      <Avatar className="size-8 rounded-md">
                        <AvatarImage src={org.avatar_url} alt={org.display_name || org.login} />
                        <AvatarFallback className="rounded-md">
                          <Building2 className="size-4" />
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{org.display_name || org.login}</p>
                        <p className="truncate text-xs text-muted-foreground">@{org.login}</p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleConnect(org.login)}
                        disabled={connecting !== null}
                      >
                        {connecting === org.login ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          'Connect'
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No organizations are ready to connect yet. Install the Keyway GitHub App on
                  your organization, then come back here.
                </p>
              )}

              {installUrl && (
                <Button
                  asChild
                  variant={connectable.length > 0 ? 'outline' : 'default'}
                  className="w-full"
                >
                  <a
                    href={installUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleInstallClick}
                  >
                    {connectable.length > 0
                      ? 'Install on another organization'
                      : 'Install Keyway GitHub App'}
                    <ExternalLink className="size-4 ml-2" />
                  </a>
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
