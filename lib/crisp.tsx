'use client'

import { useEffect } from 'react'
import { Crisp } from 'crisp-sdk-web'

let crispInitialized = false

export function CrispProvider() {
  useEffect(() => {
    const websiteId = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID
    if (!crispInitialized && typeof window !== 'undefined' && websiteId) {
      Crisp.configure(websiteId)
      crispInitialized = true
    }
  }, [])

  return null
}

/**
 * Open the Crisp chat window
 */
export function openCrispChat() {
  if (typeof window !== 'undefined') {
    Crisp.chat.open()
  }
}

/**
 * Open Crisp chat for feedback (tagged for filtering in Crisp dashboard)
 */
export function openFeedback() {
  if (typeof window !== 'undefined') {
    Crisp.session.setSegments(['feedback'], false)
    Crisp.chat.open()
  }
}

/**
 * Set user information in Crisp (for logged-in users)
 */
export function setCrispUser(user: { email?: string; name?: string; avatar?: string }) {
  if (typeof window !== 'undefined') {
    if (user.email) {
      Crisp.user.setEmail(user.email)
    }
    if (user.name) {
      Crisp.user.setNickname(user.name)
    }
    if (user.avatar) {
      Crisp.user.setAvatar(user.avatar)
    }
  }
}

/**
 * Reset Crisp session (for logout)
 */
export function resetCrispSession() {
  if (typeof window !== 'undefined') {
    Crisp.session.reset()
  }
}
