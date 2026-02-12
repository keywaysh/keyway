import Link from 'next/link'
import { ChevronDown, ChevronRight, Key, ExternalLink } from 'lucide-react'
import type { ExposureUserReport, ExposureUserSummary } from '@/lib/types'
import { formatRelativeTime } from '@/lib/date-utils'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

type RoleBadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

function getRoleBadgeProps(role: string): { variant: RoleBadgeVariant; className: string } {
  switch (role) {
    case 'admin':
      return { variant: 'destructive', className: 'text-xs' }
    case 'maintain':
    case 'write':
      return { variant: 'default', className: 'text-xs bg-amber-500 hover:bg-amber-500/80' }
    case 'read':
    default:
      return { variant: 'secondary', className: 'text-xs' }
  }
}

interface ExposureUserRowProps {
  user: ExposureUserSummary
  orgLogin: string
  isExpanded: boolean
  onToggle: () => void
  userReport: ExposureUserReport | null
  isLoadingReport: boolean
}

export function ExposureUserRow({
  user,
  orgLogin,
  isExpanded,
  onToggle,
  userReport,
  isLoadingReport,
}: ExposureUserRowProps) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="w-full p-4 flex items-center gap-4 hover:bg-accent/50 transition-colors text-left"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarImage src={user.user.avatarUrl || undefined} alt={user.user.username} />
            <AvatarFallback>{user.user.username[0].toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{user.user.username}</p>
            <p className="text-sm text-muted-foreground">
              Last access: {formatRelativeTime(user.lastAccess)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="secondary" className="text-xs">
            <Key className="h-3 w-3 mr-1" />
            {user.secretsAccessed}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {user.vaultsAccessed} {user.vaultsAccessed === 1 ? 'vault' : 'vaults'}
          </Badge>
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground ml-1" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground ml-1" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t bg-muted/20">
          {isLoadingReport ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : userReport ? (
            <div className="divide-y">
              {userReport.vaults.map((vault) => (
                <div key={vault.repoFullName} className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="font-medium text-sm">{vault.repoFullName}</span>
                    <Link
                      href={`/vaults/${vault.repoFullName}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                  <div className="space-y-2">
                    {vault.secrets.map((secret) => (
                      <div
                        key={`${secret.key}-${secret.environment}`}
                        className="flex flex-wrap items-center gap-2 text-sm py-1 pl-4 border-l-2 border-muted"
                      >
                        <code className="bg-muted px-2 py-0.5 rounded text-xs font-mono">
                          {secret.key}
                        </code>
                        <Badge variant="outline" className="text-xs">
                          {secret.environment}
                        </Badge>
                        <Badge {...getRoleBadgeProps(secret.roleAtAccess)} className={`${getRoleBadgeProps(secret.roleAtAccess).className} capitalize`}>
                          {secret.roleAtAccess}
                        </Badge>
                        <span className="text-muted-foreground text-xs ml-auto">
                          {secret.accessCount}× · {formatRelativeTime(secret.lastAccess)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">No detailed data available</p>
          )}
        </div>
      )}
    </div>
  )
}

export function ExposureUserRowSkeleton() {
  return (
    <div className="border rounded-lg p-4 flex items-center gap-4">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-4 w-20" />
    </div>
  )
}
