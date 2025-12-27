import { cn } from '@/lib/utils'

export function LoadingSpinner({ className = '' }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center', className)}>
      <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  )
}
