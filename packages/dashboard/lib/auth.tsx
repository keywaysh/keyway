'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'
import { identifyUser } from './analytics'
import type { User } from './types'

interface AuthContextValue {
  user: User | null
  isLoading: boolean
  error: string | null
  logout: () => void
  refetch: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Check if logged in cookie exists
function isLoggedIn(): boolean {
  if (typeof document === 'undefined') return false
  return document.cookie.includes('keyway_logged_in=true')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchUser = async () => {
    setIsLoading(true)
    setError(null)

    // Skip API call if not logged in
    if (!isLoggedIn()) {
      setUser(null)
      setIsLoading(false)
      return
    }

    try {
      const userData = await api.getMe()
      setUser(userData)
      // Identify user in PostHog for analytics
      if (userData) {
        identifyUser(userData.id, {
          email: userData.email,
          github_username: userData.github_username,
          name: userData.name,
          plan: userData.plan,
          created_at: userData.created_at,
          is_paying: userData.plan !== 'free',
        })
      }
    } catch (err) {
      setUser(null)
      setError(err instanceof Error ? err.message : 'Failed to fetch user')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchUser()
  }, [])

  const logout = () => {
    // Clear cookies (session cookie is HttpOnly in prod, but we set it client-side in dev)
    // Clear without domain for localhost, with domain for production
    const hostname = window.location.hostname
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1'
    if (isLocalhost) {
      document.cookie = 'keyway_logged_in=; Path=/; Max-Age=0'
      document.cookie = 'keyway_session=; Path=/; Max-Age=0'
    } else {
      // Derive cookie domain from hostname:
      // - .local domains (e.g., "app.keyway.local" -> "keyway.local")
      // - production domains (e.g., "app.keyway.sh" -> ".keyway.sh")
      const parts = hostname.split('.')
      const isLocalDomain = hostname.endsWith('.local')
      const cookieDomain = isLocalDomain
        ? parts.slice(-2).join('.')
        : parts.length >= 2 ? '.' + parts.slice(-2).join('.') : hostname
      document.cookie = `keyway_logged_in=; Path=/; Domain=${cookieDomain}; Max-Age=0`
      document.cookie = `keyway_session=; Path=/; Domain=${cookieDomain}; Max-Age=0`
    }
    setUser(null)
    window.location.href = '/'
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        error,
        logout,
        refetch: fetchUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
