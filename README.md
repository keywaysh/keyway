# Keyway Web (Next.js 15)

[![Keyway Secrets](https://keyway.sh/badge.svg?repo=NicolasRitouet/soma-app)](https://keyway.sh/repo/NicolasRitouet/soma-app)

Front-end only for marketing and backoffice UI, consuming the Keyway API.

## Stack
- Next.js 15 (App Router, TypeScript)
- No backend logic here; all data comes from the Keyway API.

## Setup
```bash
npm install
npm run dev
```

Environment variables (set in `.env.local` or Vercel project settings):
- `NEXT_PUBLIC_GITHUB_CLIENT_ID`, `NEXT_PUBLIC_GITHUB_REDIRECT`, `NEXT_PUBLIC_GITHUB_SCOPE` or `NEXT_PUBLIC_GITHUB_OAUTH_URL` → for waitlist/marketing GitHub auth.
- `NEXT_PUBLIC_KEYWAY_AUTH_URL` → front-only login link to your API OAuth entrypoint (used on `/login`).
- `NEXT_PUBLIC_POSTHOG_KEY` (+ optional `NEXT_PUBLIC_POSTHOG_HOST`, default `https://app.posthog.com`) → enable PostHog analytics on the client.
- `POSTHOG_SERVER_API_KEY` (+ optional `POSTHOG_HOST`, default `https://app.posthog.com`) → server-side PostHog for badge analytics.

Wire the API later: add your fetch client and auth/session (middleware or proxy) once the backend contract is ready.

## Deploy on Vercel (Hobby)
1. Import the repo in Vercel (root `.`).
2. Build command: `npm run build` ; Output: `.next` (default).
3. Add env vars above in Vercel.
4. Deploy. Point `keyway.sh`/`www` to Vercel when ready.

## Notes
- Next.js pinned to `^15.0.0`; adjust if you need a newer patch.
- Existing `index.html` is kept for reference; the app entry is under `app/`.

## Badge
- SVG is served from this app at `/badge.svg`. Use the `repo` query only for analytics (`?repo=org/project`); the badge visuals stay minimal (Keyway mark only).
- If `POSTHOG_SERVER_API_KEY` is set, each view is sent to PostHog (`event: badge_view`) with repo, referer, ua, path, ts. Errors are swallowed so the badge always renders.
