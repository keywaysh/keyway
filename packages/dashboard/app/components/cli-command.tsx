'use client'

import { useState, useEffect } from 'react'
import { Check, Copy, Terminal, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  CLI_INSTALL,
  CLI_COMMANDS,
  CLI_DOCS_URL,
  detectPlatform,
  type Platform,
} from '@/lib/cli'

interface CLICommandProps {
  variant?: 'default' | 'marketing' | 'compact'
  showDocs?: boolean
  className?: string
}

export function CLICommand({
  variant = 'default',
  showDocs = true,
  className,
}: CLICommandProps) {
  const [platform, setPlatform] = useState<Platform>('mac')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setPlatform(detectPlatform())
  }, [])

  const install = CLI_INSTALL[platform]

  const handleCopy = async () => {
    if (!install.copyable) return
    await navigator.clipboard.writeText(install.command)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (variant === 'marketing') {
    return (
      <div className={cn('flex flex-col items-center gap-3', className)}>
        <div className="inline-flex items-center gap-3 rounded-xl bg-gray-900 dark:bg-gray-800/80 p-4 border border-gray-700">
          {install.copyable ? (
            <>
              <code className="font-mono text-sm text-white">
                {install.command}
              </code>
              <button
                onClick={handleCopy}
                className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </>
          ) : (
            <a
              href={install.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-white hover:text-emerald-400 transition-colors"
            >
              <Download className="size-4" />
              <span className="font-medium">{install.command}</span>
            </a>
          )}
        </div>

        {showDocs && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {platform === 'windows'
              ? `Extract and run: ${CLI_COMMANDS.init}`
              : `Then run: ${CLI_COMMANDS.init}`}
            {' · '}
            <a
              href={CLI_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              Other install options
            </a>
          </p>
        )}
      </div>
    )
  }

  if (variant === 'compact') {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-3 bg-muted/30 rounded-lg font-mono text-sm border border-border',
          className
        )}
      >
        <Terminal className="size-4 text-primary shrink-0" />
        <code className="flex-1 text-foreground truncate">
          {install.copyable ? install.command : CLI_COMMANDS.init}
        </code>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="size-3.5 text-primary" />
          ) : (
            <Copy className="size-3.5 text-muted-foreground" />
          )}
          <span className="sr-only">Copy command</span>
        </Button>
      </div>
    )
  }

  // Default variant (dashboard style)
  return (
    <div className={cn('space-y-3', className)}>
      {install.copyable ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-4 font-mono text-sm">
          <Terminal className="size-4 text-primary shrink-0" />
          <code className="flex-1 text-foreground">{install.command}</code>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="size-4 text-primary" />
            ) : (
              <Copy className="size-4 text-muted-foreground" />
            )}
            <span className="sr-only">Copy command</span>
          </Button>
        </div>
      ) : (
        <a
          href={install.href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-4 font-mono text-sm hover:bg-muted transition-colors"
        >
          <Download className="size-4 text-primary shrink-0" />
          <span className="flex-1 text-foreground">{install.command}</span>
        </a>
      )}

      {showDocs && (
        <p className="text-xs text-muted-foreground">
          {platform === 'windows'
            ? `Extract and run: ${CLI_COMMANDS.init}`
            : `Then run: ${CLI_COMMANDS.init}`}
          {' · '}
          <a
            href={CLI_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Other install options
          </a>
        </p>
      )}
    </div>
  )
}
