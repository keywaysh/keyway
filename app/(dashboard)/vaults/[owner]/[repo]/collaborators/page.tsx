'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Users, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'
import type { Collaborator } from '@/lib/types'
import {
  DashboardLayout,
  CollaboratorRow,
  CollaboratorRowSkeleton,
  ErrorState,
  EmptyState,
} from '@/app/components/dashboard'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export default function CollaboratorsPage() {
  const params = useParams()
  const owner = params.owner as string
  const repo = params.repo as string

  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const hasFiredView = useRef(false)

  useEffect(() => {
    if (!hasFiredView.current) {
      hasFiredView.current = true
      trackEvent(AnalyticsEvents.COLLABORATORS_VIEW, {
        repo: `${owner}/${repo}`,
      })
    }
  }, [owner, repo])

  const fetchCollaborators = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await api.getVaultCollaborators(owner, repo)
      setCollaborators(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load collaborators')
    } finally {
      setIsLoading(false)
    }
  }, [owner, repo])

  useEffect(() => {
    fetchCollaborators()
  }, [fetchCollaborators])

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-2">
          <Link
            href={`/vaults/${owner}/${repo}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors py-2 pr-4"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to vault
          </Link>
        </div>

        <div className="mb-6">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-foreground">
                Collaborators
              </h2>
              <p className="text-muted-foreground text-sm">
                {owner}/{repo} - {collaborators.length} collaborator{collaborators.length !== 1 ? 's' : ''}
              </p>
            </>
          )}
        </div>

        {error ? (
          <ErrorState message={error} onRetry={fetchCollaborators} />
        ) : (
          <Card>
            <CardHeader className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <CardTitle className="text-base">GitHub Collaborators</CardTitle>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={`https://github.com/${owner}/${repo}/settings/access`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="w-4 h-4 mr-1.5" />
                    Manage access
                  </a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Permissions are synced from GitHub repository access levels
              </p>
            </CardHeader>

            <CardContent className="pt-0">
              {isLoading ? (
                <>
                  {[...Array(5)].map((_, i) => (
                    <CollaboratorRowSkeleton key={i} />
                  ))}
                </>
              ) : collaborators.length === 0 ? (
                <div className="py-8">
                  <EmptyState
                    title="No collaborators"
                    message="This repository has no collaborators"
                  />
                </div>
              ) : (
                collaborators.map((collaborator) => (
                  <CollaboratorRow
                    key={collaborator.login}
                    collaborator={collaborator}
                  />
                ))
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  )
}
