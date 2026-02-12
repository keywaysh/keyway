import type { ReactNode } from 'react'
import { AuthProvider } from '@/lib/auth'

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      {children}
    </AuthProvider>
  )
}
