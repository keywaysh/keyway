import { API_BASE } from '@/lib/env'

export class BaseApiClient {
  protected async request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      ...options?.headers as Record<string, string>,
    }
    // Only set Content-Type for requests with body
    if (options?.body) {
      headers['Content-Type'] = 'application/json'
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers,
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: 'Request failed' }))
      // RFC 7807 format uses 'detail', fallback to 'message' for backwards compatibility
      throw new Error(error.detail || error.message || `Request failed: ${res.status}`)
    }

    // Handle 204 No Content responses
    if (res.status === 204) {
      return undefined as T
    }

    return res.json()
  }
}
