# Repository Guidelines

## Project Structure & Module Organization
- `app/` — Next.js App Router pages: `(marketing)` landing, `(app)` dashboard shell, `login`, and `badge.svg` route.
- `app/globals.css` — shared styles (marketing + dashboard).
- `app/layout.tsx` — root metadata and PostHog client loader.
- `.env.example` — environment variable template.
- `next.config.mjs`, `tsconfig.json`, `.eslintrc.json` — build and lint config.
- `CNAME` — domain mapping for deployment.

## Build, Test, and Development Commands
- `pnpm install` — install dependencies (npm works too).
- `pnpm dev` — start local dev server on http://localhost:3000.
- `pnpm build` — production build.
- `pnpm start` — run the production build locally.
- `pnpm lint` — run Next.js/ESLint checks.

## Coding Style & Naming Conventions
- TypeScript, strict mode. Prefer React Server Components where possible.
- Keep components in `app/` with clear folder scopes; share styling in `globals.css` or component-level CSS if added later.
- Use descriptive file names (e.g., `page.tsx`, `layout.tsx`, `route.ts` for API/edge routes).
- JSX: 2-space indent, single quotes in TS/JS, trailing commas allowed.

## Testing Guidelines
- No test suite yet. If adding tests, colocate under the relevant feature (`__tests__` or `.spec.ts(x)`), and document commands in README.
- Validate builds locally with `pnpm build` before PRs.

## Commit & Pull Request Guidelines
- Commits: concise, present-tense, describe the change (e.g., `Add badge route with PostHog analytics`).
- PRs: include summary, screenshots for UI changes, and list env vars/config changes. Link issues if applicable.

## Security & Configuration Tips
- Set env vars via `.env.local` or platform settings: GitHub OAuth (`NEXT_PUBLIC_GITHUB_*`), login link (`NEXT_PUBLIC_KEYWAY_AUTH_URL`), PostHog (`NEXT_PUBLIC_POSTHOG_*`, `POSTHOG_SERVER_API_KEY`, `POSTHOG_HOST`).
- Badge analytics use PostHog server key; ensure it’s set only in secure deploy environments. Repo query parameter is for analytics only; the badge visual stays minimal (Keyway mark only).
- Do not commit real secrets; `.env.example` is the template.
