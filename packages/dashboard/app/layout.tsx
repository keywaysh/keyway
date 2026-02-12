import { type Metadata } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import clsx from 'clsx'

import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { QueryProvider } from './providers'
import { CrispProvider } from '@/lib/crisp'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: {
    template: '%s | Keyway',
    default: 'Dashboard | Keyway',
  },
  description: 'Manage your secrets and vaults',
  metadataBase: new URL(process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://app.keyway.sh'),
  robots: {
    index: false,
    follow: false,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com'

  return (
    <html lang="en" className={clsx('antialiased', inter.variable)} suppressHydrationWarning>
      <body className="bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            {children}
          </QueryProvider>
          <Toaster richColors position="bottom-right" />
          <CrispProvider />
        </ThemeProvider>
        {posthogKey ? (
          <>
            <Script
              id="posthog-js"
              src={`${posthogHost}/static/array.js`}
              strategy="afterInteractive"
            />
            <Script
              id="posthog-init"
              strategy="afterInteractive"
            >
              {`window.posthog && window.posthog.init('${posthogKey}', {
                api_host: '${posthogHost}',
                capture_pageview: true,
                capture_pageleave: true,
                autocapture: true,
                persistence: 'localStorage+cookie',
                capture_performance: true
              })`}
            </Script>
          </>
        ) : null}
      </body>
    </html>
  )
}
