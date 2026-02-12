/**
 * Format a date string as a relative time (e.g., "5m ago", "3d ago")
 * @param dateString - ISO date string
 * @param options - Configuration options
 * @returns Formatted relative time string
 */
export function formatRelativeTime(
  dateString: string,
  options: {
    /** Days threshold before showing full date (default: 30) */
    daysThreshold?: number
    /** Date format for dates beyond threshold */
    dateFormat?: Intl.DateTimeFormatOptions
  } = {}
): string {
  const { daysThreshold = 30, dateFormat } = options
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < daysThreshold) return `${diffDays}d ago`

  if (dateFormat) {
    return date.toLocaleDateString('en-US', dateFormat)
  }
  return date.toLocaleDateString()
}

/**
 * Format a sync date, handling null values
 * @param dateString - ISO date string or null
 * @returns Formatted string or "Never synced"
 */
export function formatLastSynced(dateString: string | null): string {
  if (!dateString) return 'Never synced'
  return formatRelativeTime(dateString, { daysThreshold: 7 })
}
