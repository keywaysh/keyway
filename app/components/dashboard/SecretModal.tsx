'use client'

import { useState, useEffect } from 'react'
import type { Secret } from '@/lib/types'
import { secretSchema, secretEditSchema } from '@/lib/validations'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

interface SecretModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: { name: string; value: string; environments: string[] }) => Promise<void>
  secret?: Secret | null
  environments?: string[]
  isLoading?: boolean
}

export function SecretModal({ isOpen, onClose, onSubmit, secret, environments = ['default'], isLoading }: SecretModalProps) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [selectedEnvironments, setSelectedEnvironments] = useState<string[]>([])
  const [isAddingEnv, setIsAddingEnv] = useState(false)
  const [newEnvName, setNewEnvName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const isEditing = !!secret

  useEffect(() => {
    if (secret) {
      setName(secret.name)
      setValue('')
      setSelectedEnvironments([secret.environment])
      setIsAddingEnv(false)
      setNewEnvName('')
    } else {
      setName('')
      setValue('')
      // All environments selected by default for new secrets
      setSelectedEnvironments([...environments])
      setIsAddingEnv(false)
      setNewEnvName('')
    }
    setError(null)
  }, [secret, isOpen, environments])

  const toggleEnvironment = (env: string) => {
    setSelectedEnvironments(prev =>
      prev.includes(env)
        ? prev.filter(e => e !== env)
        : [...prev, env]
    )
  }

  const handleAddNewEnv = () => {
    const envName = newEnvName.trim().toLowerCase()
    if (envName && !environments.includes(envName) && !selectedEnvironments.includes(envName)) {
      setSelectedEnvironments(prev => [...prev, envName])
    }
    setNewEnvName('')
    setIsAddingEnv(false)
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData('text')
    const match = pasted.match(/^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/)
    if (match) {
      e.preventDefault()
      const [, key, val] = match
      setName(key.toUpperCase())
      setValue(val)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const formData = {
      name: name.trim(),
      value: value.trim(),
      environments: selectedEnvironments,
    }

    // Use the appropriate schema based on editing mode
    const schema = isEditing ? secretEditSchema : secretSchema
    const result = schema.safeParse(formData)

    if (!result.success) {
      // Get the first error message
      const firstError = result.error.issues[0]
      setError(firstError.message)
      return
    }

    try {
      await onSubmit(result.data)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save secret')
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Secret' : 'Create Secret'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="secret-name">Name</Label>
            <Input
              id="secret-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
              onPaste={handlePaste}
              placeholder="API_KEY"
              disabled={isEditing}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Only uppercase letters, numbers, and underscores
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="secret-value">Value</Label>
            <textarea
              id="secret-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onPaste={handlePaste}
              placeholder={isEditing ? '••••••••••••••••' : 'Enter secret value or paste KEY=value'}
              rows={3}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono resize-none"
            />
            {isEditing && (
              <p className="text-xs text-muted-foreground">
                Leave empty to keep the current value
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{isEditing ? 'Environment' : 'Environments'}</Label>
            {isEditing ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-input bg-muted/50">
                <span className="text-sm">{selectedEnvironments[0]}</span>
              </div>
            ) : (
              <>
                <div className="space-y-2 max-h-48 overflow-y-auto rounded-md border border-input p-3">
                  {/* Existing environments */}
                  {environments.map((env) => (
                    <div key={env} className="flex items-center space-x-2">
                      <Checkbox
                        id={`env-${env}`}
                        checked={selectedEnvironments.includes(env)}
                        onCheckedChange={() => toggleEnvironment(env)}
                      />
                      <label
                        htmlFor={`env-${env}`}
                        className="text-sm cursor-pointer select-none"
                      >
                        {env}
                      </label>
                    </div>
                  ))}
                  {/* New environments added inline */}
                  {selectedEnvironments
                    .filter(env => !environments.includes(env))
                    .map((env) => (
                      <div key={env} className="flex items-center space-x-2">
                        <Checkbox
                          id={`env-${env}`}
                          checked={true}
                          onCheckedChange={() => toggleEnvironment(env)}
                        />
                        <label
                          htmlFor={`env-${env}`}
                          className="text-sm cursor-pointer select-none text-primary"
                        >
                          {env} <span className="text-xs text-muted-foreground">(new)</span>
                        </label>
                      </div>
                    ))}
                </div>
                {/* Actions row */}
                <div className="flex items-center justify-between">
                  <div className="flex gap-3 text-xs">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setSelectedEnvironments([...environments])}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setSelectedEnvironments([])}
                    >
                      Deselect all
                    </button>
                  </div>
                  {!isAddingEnv ? (
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => setIsAddingEnv(true)}
                    >
                      + Add environment
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Input
                        type="text"
                        value={newEnvName}
                        onChange={(e) => setNewEnvName(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '-'))}
                        placeholder="env-name"
                        className="h-7 w-full sm:w-28 text-xs"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleAddNewEnv()
                          } else if (e.key === 'Escape') {
                            setIsAddingEnv(false)
                            setNewEnvName('')
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={handleAddNewEnv}
                      >
                        Add
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

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
              type="submit"
              disabled={isLoading}
              className="flex-1"
            >
              {isLoading ? 'Saving...' : isEditing ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
