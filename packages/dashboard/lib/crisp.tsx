'use client'

import { useEffect } from 'react'

let crispInitialized = false
let crispModule: typeof import('crisp-sdk-web') | null = null

export function CrispProvider() {
  useEffect(() => {
    const websiteId = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID
    if (!crispInitialized && typeof window !== 'undefined' && websiteId) {
      import('crisp-sdk-web').then((module) => {
        crispModule = module
        module.Crisp.configure(websiteId)
        crispInitialized = true
      })
    }
  }, [])

  return null
}

/**
 * Open Crisp chat for feedback (tagged for filtering in Crisp dashboard)
 */
export function openFeedback() {
  if (typeof window !== 'undefined' && crispModule) {
    crispModule.Crisp.session.setSegments(['feedback'], false)
    crispModule.Crisp.chat.open()
  }
}
