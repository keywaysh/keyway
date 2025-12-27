import { AlertTriangle, Inbox, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
}

interface EmptyStateProps {
  title: string
  message: string
  action?: React.ReactNode
  icon?: LucideIcon
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
        <AlertTriangle className="h-6 w-6 text-destructive" />
      </div>
      <div className="text-center">
        <h3 className="font-medium text-foreground mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function EmptyState({ title, message, action, icon: Icon = Inbox }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <div className="text-center">
        <h3 className="font-medium text-foreground mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      {action}
    </div>
  )
}
