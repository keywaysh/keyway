import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Public paths that don't require authentication
const publicPaths = ['/login', '/auth/callback']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const loggedInCookie = request.cookies.get('keyway_logged_in')
  const isLoggedIn = loggedInCookie?.value === 'true'

  // Check if path is public (login, callback)
  const isPublicPath = publicPaths.some(path => pathname.startsWith(path))

  // Public paths - always accessible
  if (isPublicPath) {
    // If already logged in and on /login, redirect to home
    if (pathname === '/login' && isLoggedIn) {
      return NextResponse.redirect(new URL('/', request.url))
    }
    return addSecurityHeaders(NextResponse.next(), request)
  }

  // All other paths require authentication
  if (!isLoggedIn) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return addSecurityHeaders(NextResponse.next(), request)
}

function addSecurityHeaders(response: NextResponse, request: NextRequest) {
  // Content Security Policy (CSP)
  // Allow PostHog analytics, GitHub avatars, and Crisp chat (conditionally)
  const apiUrl = process.env.NEXT_PUBLIC_KEYWAY_API_URL || 'https://api.keyway.sh'
  const hasPosthog = !!process.env.NEXT_PUBLIC_POSTHOG_KEY
  const hasCrisp = !!process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID

  const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com'
  const posthogScriptSrc = hasPosthog ? ` ${posthogHost} https://us.i.posthog.com` : ''
  const crispScriptSrc = hasCrisp ? ' https://client.crisp.chat' : ''
  const crispStyleSrc = hasCrisp ? ' https://client.crisp.chat' : ''
  const crispFontSrc = hasCrisp ? ' https://client.crisp.chat' : ''
  const posthogConnectSrc = hasPosthog ? ` ${posthogHost} https://us.i.posthog.com` : ''
  const crispConnectSrc = hasCrisp ? ' https://client.crisp.chat wss://client.relay.crisp.chat wss://stream.relay.crisp.chat https://storage.crisp.chat' : ''
  const crispFrameSrc = hasCrisp ? ' https://game.crisp.chat' : ''

  const cspDirectives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval'${posthogScriptSrc}${crispScriptSrc}`,
    `style-src 'self' 'unsafe-inline'${crispStyleSrc}`,
    "img-src 'self' data: https: blob:",
    `font-src 'self' data:${crispFontSrc}`,
    `connect-src 'self'${posthogConnectSrc} ${apiUrl} https://localhost${crispConnectSrc}`,
    `frame-src 'self'${crispFrameSrc}`,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ]
  response.headers.set('Content-Security-Policy', cspDirectives.join('; '))

  // Additional security headers
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')

  // CSRF protection via origin checking for state-changing methods
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  const method = request.method

  // Check origin for state-changing requests
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (origin && host) {
      const originHost = new URL(origin).host
      if (originHost !== host) {
        // Reject cross-origin state-changing requests
        return new NextResponse('Forbidden: Invalid origin', { status: 403 })
      }
    }
  }

  return response
}

export const config = {
  matcher: [
    // Apply to all routes except static files and API routes
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
