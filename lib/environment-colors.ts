export const environmentColors: Record<string, { bg: string; border: string; text: string }> = {
  local: {
    bg: 'bg-slate-500/15',
    border: 'border-slate-500/30',
    text: 'text-slate-600 dark:text-slate-400',
  },
  development: {
    bg: 'bg-blue-500/15',
    border: 'border-blue-500/30',
    text: 'text-blue-600 dark:text-blue-400',
  },
  staging: {
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/30',
    text: 'text-amber-600 dark:text-amber-400',
  },
  production: {
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-500/30',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
}

const fallbackColor = {
  bg: 'bg-purple-500/15',
  border: 'border-purple-500/30',
  text: 'text-purple-600 dark:text-purple-400',
}

export function getEnvironmentColor(env: string) {
  return environmentColors[env] || fallbackColor
}
