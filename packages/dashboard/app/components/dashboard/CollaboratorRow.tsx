import { ExternalLink } from 'lucide-react'
import type { Collaborator, VaultPermission } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

// GitHub role config with colors matching the plan in vault detail page
const permissionConfig: Record<VaultPermission, {
  label: string
  color: string
  bgColor: string
}> = {
  admin: {
    label: 'Admin',
    color: 'text-amber-400',
    bgColor: 'bg-amber-400/10',
  },
  maintain: {
    label: 'Maintain',
    color: 'text-purple-400',
    bgColor: 'bg-purple-400/10',
  },
  write: {
    label: 'Write',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-400/10',
  },
  triage: {
    label: 'Triage',
    color: 'text-blue-400',
    bgColor: 'bg-blue-400/10',
  },
  read: {
    label: 'Read',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
  },
}

interface CollaboratorRowProps {
  collaborator: Collaborator
}

export function CollaboratorRow({ collaborator }: CollaboratorRowProps) {
  const config = permissionConfig[collaborator.permission]

  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        <Avatar className="h-10 w-10 shrink-0">
          <AvatarImage src={collaborator.avatarUrl} alt={collaborator.login} />
          <AvatarFallback>{collaborator.login.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="font-medium text-foreground truncate">
            {collaborator.login}
          </div>
          <div className={`text-xs font-medium ${config.color}`}>
            {config.label}
          </div>
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        asChild
        className="text-muted-foreground hover:text-foreground shrink-0"
      >
        <a href={collaborator.htmlUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-4 w-4 mr-1.5" />
          GitHub
        </a>
      </Button>
    </div>
  )
}

export function CollaboratorRowSkeleton() {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-1.5 h-3 w-16" />
        </div>
      </div>
      <Skeleton className="h-8 w-20 rounded-lg" />
    </div>
  )
}

export function PermissionBadge({ permission }: { permission: VaultPermission }) {
  const config = permissionConfig[permission]

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${config.bgColor} ${config.color}`}>
      {config.label}
    </span>
  )
}
