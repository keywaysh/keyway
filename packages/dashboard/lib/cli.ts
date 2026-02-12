export type Platform = 'mac' | 'linux' | 'windows'

const landingUrl = process.env.NEXT_PUBLIC_LANDING_URL || 'https://keyway.sh'
const cliReleasesUrl = process.env.NEXT_PUBLIC_CLI_RELEASES_URL || 'https://github.com/keywaysh/cli/releases/latest'
const brewTap = process.env.NEXT_PUBLIC_BREW_TAP || 'keywaysh/tap/keyway'

export const CLI_INSTALL = {
  mac: {
    command: `brew install ${brewTap}`,
    copyable: true,
  },
  linux: {
    command: `curl -fsSL ${landingUrl}/install.sh | sh`,
    copyable: true,
  },
  windows: {
    command: 'Download for Windows',
    copyable: false,
    href: cliReleasesUrl,
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

const docsUrl = process.env.NEXT_PUBLIC_DOCS_URL || 'https://docs.keyway.sh'
export const CLI_DOCS_URL = `${docsUrl}/installation`

export function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'mac'

  const ua = navigator.userAgent.toLowerCase()
  const platform = navigator.platform?.toLowerCase() || ''

  if (platform.includes('mac') || ua.includes('mac')) return 'mac'
  if (platform.includes('win') || ua.includes('win')) return 'windows'
  return 'linux'
}
