export type Platform = 'mac' | 'linux' | 'windows'

export const CLI_INSTALL = {
  mac: {
    command: 'brew install keywaysh/tap/keyway',
    copyable: true,
  },
  linux: {
    command: 'curl -fsSL https://keyway.sh/install.sh | sh',
    copyable: true,
  },
  windows: {
    command: 'Download for Windows',
    copyable: false,
    href: 'https://github.com/keywaysh/cli/releases/latest',
  },
} as const

export const CLI_COMMANDS = {
  init: 'keyway init',
  pull: 'keyway pull',
  sync: 'keyway sync',
  run: 'keyway run -- npm start',
} as const

export const CLI_NPX = {
  base: 'npx @keywaysh/cli',
  init: 'npx @keywaysh/cli init',
  pull: 'npx @keywaysh/cli pull',
  sync: 'npx @keywaysh/cli sync',
} as const

export const CLI_DOCS_URL = 'https://docs.keyway.sh/installation'

export function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'mac'

  const ua = navigator.userAgent.toLowerCase()
  const platform = navigator.platform?.toLowerCase() || ''

  if (platform.includes('mac') || ua.includes('mac')) return 'mac'
  if (platform.includes('win') || ua.includes('win')) return 'windows'
  return 'linux'
}
