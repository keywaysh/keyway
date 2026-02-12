import { Github, ExternalLink, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface GitHubAppNotInstalledStateProps {
  error: string
  onRetry: () => void
}

export function GitHubAppNotInstalledState({ error, onRetry }: GitHubAppNotInstalledStateProps) {
  // Extract repo name from error message like "GitHub App not installed for owner/repo"
  const repoMatch = error.match(/GitHub App not installed for ([^\s.]+)/)
  const repoName = repoMatch ? repoMatch[1] : null

  // Extract install URL if present
  const urlMatch = error.match(/(https:\/\/github\.com\/apps\/[^\s]+)/)
  const defaultInstallUrl = process.env.NEXT_PUBLIC_GITHUB_APP_INSTALL_URL || 'https://github.com/apps/keyway/installations/new'
  const installUrl = urlMatch ? urlMatch[1] : defaultInstallUrl

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="relative mb-6">
        <div className="absolute inset-0 bg-amber-500/20 blur-xl rounded-full" />
        <div className="relative flex size-20 items-center justify-center rounded-2xl bg-linear-to-br from-amber-500 to-orange-600 shadow-lg">
          <Github className="size-10 text-white" />
        </div>
      </div>

      <h3 className="text-2xl font-semibold text-foreground mb-2">GitHub App Not Installed</h3>
      <p className="text-muted-foreground text-center max-w-md mb-2">
        {repoName ? (
          <>
            The Keyway GitHub App is not installed on <code className="text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">{repoName}</code>.
          </>
        ) : (
          'The Keyway GitHub App needs to be installed to access your repositories.'
        )}
      </p>
      <p className="text-sm text-muted-foreground text-center max-w-md mb-8">
        Install the app to grant Keyway access to manage secrets for your repositories.
      </p>

      <div className="flex gap-3">
        <Button asChild size="lg" className="gap-2">
          <a href={installUrl} target="_blank" rel="noopener noreferrer">
            <Github className="size-5" />
            Install GitHub App
            <ExternalLink className="size-4" />
          </a>
        </Button>
        <Button variant="outline" size="lg" onClick={onRetry} className="gap-2">
          <RefreshCcw className="size-4" />
          Retry
        </Button>
      </div>
    </div>
  )
}
