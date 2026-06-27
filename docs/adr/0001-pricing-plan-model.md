# 1. Pricing & plan model

- **Status:** Accepted
- **Date:** 2026-06-27
- **PR:** #22

## Context

The previous grid was inconsistent (USD in code, "Startup" as the top tier above
"Team", per-price Stripe IDs in env vars that differ between Test and Live, an
unenforced collaborator cap). Competitors (Doppler, Snyk, Infisical) price
per-seat. We target solo devs and small teams who are priced out by per-seat, and
want a model that is simple to choose, simple to build, and differentiating.

## Decision

1. **Tiers:** `Free` · `Pro` · `Team` · `Business`. The premium tier was renamed
   `startup` → `business` (universal SaaS ladder; "Startup" reads as an entry/discount
   tier everywhere, never premium). Enum migration `0043` renames the value in place.
2. **Audience:** Free/Pro are individual plans; Team/Business are org-capable (a
   GitHub org subscribes to either). Team/Business remain purchasable by individuals
   too — a personal account's private repos live under that account, so the repo
   scaling lever must work without forcing an org migration.
3. **Flat pricing, no per-seat, no member/collaborator caps.** Fixed price per tier
   = frictionless choice + differentiation. The only scaling lever is **private
   repos**: Free 1, Pro 10, Team 20, Business 50. Currency is EUR (€9/€19/€39 per
   month; annual ≈ ×10).
4. **Feature gating:** `Business` (top tier) is the only plan that unlocks **Exposure
   reports** (secret-access tracking). Gating is hierarchical and fail-closed via
   `planRank()` / `hasExposureAccess()` (`>= business`), enforced server-side on
   every secret-access-tracking route, with the ownership check before the plan gate.
5. **Stripe as source of truth:** prices are resolved at runtime via `lookup_key`
   (`pro_*`, `team_*`, `business_*_eur`), which are identical across Test and Live
   (price IDs are not). Amounts and currency come from Stripe; per-price
   `STRIPE_PRICE_*` env vars are removed. USD can be added later via `*_usd` keys.
6. **Organizations:** subscribe to Team or Business; a trial grants Business (top
   tier, so prospects experience Exposure). A paid org cannot start a free trial, and
   org checkout is guarded against creating a second subscription (route-level check
   plus an authoritative Stripe `subscriptions.list` lookup; active trials may convert).

## Consequences

- **Positive:** one clear ladder; amounts live only in Stripe (no code change to
  re-price); "no per-seat / unlimited collaborators" is a sales argument; flat is
  cheap to build and reason about.
- **Trade-off:** revenue ceiling is bounded by design (mitigation: a future
  `Enterprise` tier sits on top, feature-gated, without touching the flat tiers).
- **Migration / grandfathering:** Exposure moved Team → Business — existing Team
  subscribers (and the per-secret access-history endpoint) lose it; communicate
  before deploy. Stripe must be configured with the six `lookup_key`s (Test + Live)
  before deploying, and migration `0043` must run with/before the backend.
