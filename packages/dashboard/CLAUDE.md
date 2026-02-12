# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Keyway Dashboard is the authenticated Next.js 15 frontend for Keyway secrets management. Uses App Router, shadcn/ui components, and Tailwind CSS v4.

## Development Commands

**This project requires pnpm.**

```bash
pnpm install          # Install dependencies
pnpm dev              # Dev server (localhost:3000)
pnpm build            # Production build
pnpm start            # Start production server
pnpm lint             # ESLint
pnpm test             # Run tests
```

## Architecture

### Directory Structure
```
app/
├── (dashboard)/           # Authenticated dashboard (protected)
│   ├── page.tsx           # Vault list (home)
│   ├── activity/          # Activity log
│   ├── api-keys/          # API key management
│   ├── orgs/              # Organization management
│   │   └── [org]/         # Org detail, billing, members
│   ├── security/          # Security overview
│   ├── settings/          # User settings
│   ├── upgrade/           # Plan upgrade
│   └── vaults/
│       └── [owner]/[repo]/ # Vault detail, secrets
├── login/                 # Login page
├── auth/
│   └── callback/          # OAuth callback handling
├── badge.svg/             # Dynamic SVG badge
├── components/
│   ├── dashboard/         # Dashboard-specific components
│   └── Button.tsx, etc.   # Shared components
└── lib/
    ├── api.ts             # Keyway API client
    ├── auth.tsx           # Auth context provider
    ├── analytics.ts       # PostHog tracking
    └── types.ts           # TypeScript types
```

### Key Components

```
app/components/dashboard/
├── VaultCard.tsx          # Vault list item
├── SecretRow.tsx          # Secret table row
├── Sidebar.tsx            # Navigation sidebar
├── Topbar.tsx             # Top navigation
└── modals/                # Create/edit modals
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

## Environment Variables

```
NEXT_PUBLIC_KEYWAY_API_URL=https://api.keyway.sh
NEXT_PUBLIC_POSTHOG_KEY=...
NEXT_PUBLIC_CRISP_WEBSITE_ID=...
```

## Key Patterns

**Protected Routes**: All dashboard routes require authentication via middleware.

**Data Fetching**: Client-side with React Query (useQuery hooks).

**Error Handling**: API errors throw with RFC 7807 `detail` field.
```typescript
try {
  await api.createSecret(...);
} catch (error) {
  toast.error(error.message);
}
```
