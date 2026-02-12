import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const svgTemplate = () => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="138" height="20" role="img" aria-label=".env by Keyway">
  <linearGradient id="g" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="c"><rect width="138" height="20" rx="3"/></clipPath>
  <g clip-path="url(#c)">
    <rect width="24" height="20" fill="#00dc82"/>
    <rect x="24" width="114" height="20" fill="#555"/>
  </g>
  <rect width="138" height="20" fill="url(#g)"/>
  <g fill="#fff" transform="translate(6, 4)">
    <path d="M7 6a2 2 0 1 0-4 0 2 2 0 0 0 4 0zm-2-3a3 3 0 1 1-1.27 5.73l-.5.5-.23.23H2v1h-1v1H0v-1.54l2.27-2.27A3 3 0 0 1 5 3zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>
  </g>
  <text x="81" y="14" fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,sans-serif" font-size="11">.env by Keyway</text>
</svg>`;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const repo = searchParams.get('repo') || 'keyway.sh';
  const posthogKey = process.env.POSTHOG_SERVER_API_KEY;
  const posthogHost = (process.env.POSTHOG_HOST ?? 'https://app.posthog.com').replace(/\/$/, '');

  if (posthogKey) {
    const payload = {
      api_key: posthogKey,
      event: 'badge_view',
      properties: {
        repo,
        referer: request.headers.get('referer'),
        ua: request.headers.get('user-agent'),
        path: request.nextUrl.pathname + request.nextUrl.search,
        ts: Date.now()
      },
      distinct_id: repo
    };

    fetch(`${posthogHost}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
  }

  const svg = svgTemplate();
  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      // Short cache on edge/CDN so analytics still get traffic samples.
      'Cache-Control': 'public, max-age=0, s-maxage=600',
      // Security headers for SVG content
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    }
  });
}
