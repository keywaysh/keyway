# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Keyway Site is the Next.js 15 frontend for Keyway, providing marketing pages and a dashboard for managing secrets. Uses App Router, shadcn/ui components, and Tailwind CSS v4.

## Development Commands

```bash
pnpm install          # Install dependencies
pnpm run dev          # Dev server (localhost:3000)
pnpm run build        # Production build
pnpm run start        # Start production server
pnpm run lint         # ESLint
pnpm run type-check   # TypeScript check
```

## Architecture

### Directory Structure
```
app/
├── (marketing)/         # Public marketing pages
│   ├── page.tsx         # Landing page
│   ├── pricing/         # Pricing page
│   └── terms/           # Legal pages
├── (app)/               # Authenticated dashboard
│   └── dashboard/
│       ├── page.tsx     # Vault list
│       ├── [owner]/[repo]/  # Vault detail
│       └── settings/    # User settings, billing
├── (public)/            # Public vault views
├── admin/               # Admin dashboard
├── auth/
│   └── callback/        # OAuth callback handling
├── login/               # Login page
├── badge.svg/           # Dynamic SVG badge
├── components/          # Shared components
└── lib/
    ├── api.ts           # Keyway API client
    ├── auth.tsx         # Auth context provider
    ├── analytics.ts     # PostHog tracking
    └── types.ts         # TypeScript types
```

### Route Groups

- `(marketing)` - Public pages, no auth required
- `(app)` - Dashboard, requires authentication
- `(public)` - Public vault views (read-only)

### Key Components

```
app/components/
├── dashboard/
│   ├── vault-card.tsx      # Vault list item
│   ├── secret-row.tsx      # Secret table row
│   ├── environment-tabs.tsx # Environment switcher
│   └── modals/             # Create/edit modals
└── ui/                     # shadcn/ui components
```

### API Client (`lib/api.ts`)

```typescript
import { api } from '@/lib/api';

// All methods return unwrapped data from { data, meta } response
const vaults = await api.getVaults();
const usage = await api.getUsage();
await api.createSecretByRepo(owner, repo, { name, value, environment });
```

### Authentication (`lib/auth.tsx`)

```typescript
import { useAuth } from '@/lib/auth';

function Component() {
  const { user, isLoading, isAuthenticated } = useAuth();
  // user: { id, name, email, avatar_url, github_username }
}
```

### Analytics (`lib/analytics.ts`)

```typescript
import { trackEvent, AnalyticsEvents } from '@/lib/analytics';

trackEvent(AnalyticsEvents.VAULT_CREATED, { repo: 'owner/repo' });
```

## UI Components

Uses **shadcn/ui** with Tailwind CSS v4. Components in `components/ui/`.

```typescript
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
```

### Tailwind CSS v4 Notes

- Use `bg-linear-*` not `bg-gradient-*`
- Use opacity modifiers: `bg-red-500/50` not `bg-opacity-50`
- Use `gap-*` not `space-x-*` in flex containers
- Use `text-base/6` for line-height modifiers
- See `keyway-infra/CLAUDE.md` for full Tailwind v4 guidelines

## Environment Variables

```
NEXT_PUBLIC_KEYWAY_API_URL=https://api.keyway.sh
NEXT_PUBLIC_POSTHOG_KEY=...
NEXT_PUBLIC_POSTHOG_HOST=...
```

## Key Patterns

**Protected Routes**: Dashboard pages check auth in layout
```typescript
// app/(app)/layout.tsx
const { isAuthenticated, isLoading } = useAuth();
if (!isAuthenticated && !isLoading) redirect('/login');
```

**Data Fetching**: Client-side with useEffect + api client
```typescript
useEffect(() => {
  api.getVaults().then(setVaults).catch(console.error);
}, []);
```

**Error Handling**: API errors throw with RFC 7807 `detail` field
```typescript
try {
  await api.createSecret(...);
} catch (error) {
  toast.error(error.message); // Shows error.detail from API
}
```
