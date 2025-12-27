# Keyway Dashboard

Authenticated dashboard application for Keyway secrets management.

## Stack

- Next.js 15 (App Router, TypeScript)
- Tailwind CSS v4
- shadcn/ui components
- React Query for data fetching

## Local Development

### Prerequisites

- Node.js 20+
- pnpm 9+
- Running instance of [keyway-backend](https://github.com/keywaysh/keyway-backend)

### Setup

```bash
# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env.local

# Start development server (port 3000)
pnpm dev
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_KEYWAY_API_URL` | Backend API URL | `http://localhost:3000` |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog analytics key | - |
| `NEXT_PUBLIC_CRISP_WEBSITE_ID` | Crisp live chat ID | - |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry error tracking | - |

### Running with Backend

```bash
# Terminal 1: Backend (port 3000)
cd ../keyway-backend && pnpm dev

# Terminal 2: Dashboard (port 3002 to avoid conflict)
cd ../keyway-dashboard && pnpm dev --port 3002
```

Then update `.env.local`:
```
NEXT_PUBLIC_KEYWAY_API_URL=http://localhost:3000
```

## Production Deployment

### Vercel

1. Import repository in Vercel
2. Set environment variables:
   - `NEXT_PUBLIC_KEYWAY_API_URL=https://api.keyway.sh`
3. Configure domain: `app.keyway.sh`

## Testing

```bash
pnpm test          # Run tests
pnpm test:watch    # Watch mode
pnpm test:coverage # Coverage report
```

## License

MIT
