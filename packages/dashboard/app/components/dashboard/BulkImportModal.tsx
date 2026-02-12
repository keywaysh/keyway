'use client'

import { useState, useEffect } from 'react'
import { Upload, FileText, AlertCircle, CheckCircle2 } from 'lucide-react'
import { trackEvent, AnalyticsEvents } from '@/lib/analytics'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

interface ParsedSecret {
  name: string
  value: string
  valid: boolean
  error?: string
}

interface BulkImportModalProps {
  isOpen: boolean
  onClose: () => void
  onImport: (secrets: { name: string; value: string; environment: string }[]) => Promise<void>
  environments: string[]
  existingSecretNames: Set<string>
}

function parseEnvContent(content: string): ParsedSecret[] {
  const lines = content.split('\n')
  const secrets: ParsedSecret[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    // Match KEY=value pattern (handles quoted values, multiline, etc.)
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)

    if (match) {
      const [, name, rawValue] = match
      // Remove surrounding quotes if present
      let value = rawValue
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }

      secrets.push({
        name: name.toUpperCase(),
        value,
        valid: true,
      })
    } else {
      // Invalid line
      secrets.push({
        name: trimmed.substring(0, 20) + (trimmed.length > 20 ? '...' : ''),
        value: '',
        valid: false,
        error: 'Invalid format. Expected KEY=value',
      })
    }
  }

  return secrets
}

export function BulkImportModal({
  isOpen,
  onClose,
  onImport,
  environments,
  existingSecretNames
}: BulkImportModalProps) {
  const [content, setContent] = useState('')
  const [environment, setEnvironment] = useState(environments[0] || 'default')
  const [parsedSecrets, setParsedSecrets] = useState<ParsedSecret[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setContent('')
      setParsedSecrets([])
      setEnvironment(environments[0] || 'default')
      setError(null)
      trackEvent(AnalyticsEvents.BULK_IMPORT_OPEN)
    }
  }, [isOpen, environments])

  useEffect(() => {
    if (content) {
      const parsed = parseEnvContent(content)
      // Mark duplicates
      const withDuplicates = parsed.map(secret => {
        if (secret.valid && existingSecretNames.has(secret.name)) {
          return {
            ...secret,
            error: 'Already exists (will be skipped)',
          }
        }
        return secret
      })
      setParsedSecrets(withDuplicates)
    } else {
      setParsedSecrets([])
    }
  }, [content, existingSecretNames])

  const validSecrets = parsedSecrets.filter(s => s.valid && !s.error)
  const invalidSecrets = parsedSecrets.filter(s => !s.valid || s.error)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        setContent(event.target?.result as string || '')
      }
      reader.readAsText(file)
    }
  }

  const handleImport = async () => {
    if (validSecrets.length === 0) {
      setError('No valid secrets to import')
      return
    }

    setIsImporting(true)
    setError(null)

    try {
      await onImport(
        validSecrets.map(s => ({
          name: s.name,
          value: s.value,
          environment,
        }))
      )
      trackEvent(AnalyticsEvents.BULK_IMPORT_SUCCESS, {
        count: validSecrets.length,
        environment,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import secrets')
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Bulk Import Secrets
          </DialogTitle>
          <DialogDescription>
            Paste your .env file content or upload a file to import multiple secrets at once.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label>Environment</Label>
            <Select value={environment} onValueChange={setEnvironment}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {environments.map((env) => (
                  <SelectItem key={env} value={env}>{env}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>.env Content</Label>
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".env,.env.*,text/plain"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button variant="ghost" size="sm" asChild>
                  <span>
                    <FileText className="h-4 w-4 mr-1" />
                    Upload file
                  </span>
                </Button>
              </label>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={`# Paste your .env file content here
API_KEY=your-api-key
DATABASE_URL=postgres://...
SECRET_TOKEN=abc123`}
              rows={8}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono resize-none"
            />
          </div>

          {parsedSecrets.length > 0 && (
            <>
              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Preview</span>
                  <div className="flex items-center gap-2">
                    {validSecrets.length > 0 && (
                      <Badge variant="default" className="bg-green-500/10 text-green-600 dark:text-green-400">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        {validSecrets.length} valid
                      </Badge>
                    )}
                    {invalidSecrets.length > 0 && (
                      <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        {invalidSecrets.length} skipped
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="max-h-48 overflow-y-auto rounded-md border border-border">
                  {parsedSecrets.map((secret, index) => (
                    <div
                      key={index}
                      className={`flex items-center justify-between px-3 py-2 text-sm border-b border-border last:border-0 ${
                        secret.valid && !secret.error
                          ? 'bg-background'
                          : 'bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {secret.valid && !secret.error ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0" />
                        )}
                        <span className="font-mono truncate">{secret.name}</span>
                      </div>
                      {secret.error && (
                        <span className="text-xs text-muted-foreground truncate ml-2">
                          {secret.error}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={isImporting || validSecrets.length === 0}
              className="flex-1"
            >
              {isImporting ? 'Importing...' : `Import ${validSecrets.length} secret${validSecrets.length !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
