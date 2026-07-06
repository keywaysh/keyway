# 2. Flat-tier pricing: drop the Pro tier, uncap paid private repos

- **Status:** Accepted — supersedes [ADR 0001](./0001-pricing-plan-model.md)
- **Date:** 2026-07-02

## Context

ADR 0001 modelled four tiers differentiated by a private-repo count (Free 1,
Pro 10, Team 20, Business 50), purchasable by individuals as well as
organizations. Two problems surfaced. Differentiating tiers by a repo counter
tied entitlements to repository topology rather than to anything the product
gates, and selling the same paid tiers to both personal accounts and
organizations made the payment workflow ambiguous (an owner could pay for
themselves while intending to pay for their org).

## Decision

1. **Tiers:** `Free` · `Team` · `Business`. The `pro` value is removed from the
   `user_plan` enum (migration `0044` remaps data then rebuilds the enum —
   Postgres cannot drop an enum value in place).
2. **Paid tiers are flat per organization and differ by features, not quotas.**
   Team and Business have unlimited private repos, providers, and environments;
   Business additionally unlocks Exposure (secret-access tracking) — the only
   feature gate enforced in code today (`hasExposureAccess`); further
   governance features on Business (e.g. SSO) are planned but not yet
   implemented. Members/collaborators are never capped on any tier (access
   mirrors GitHub: repo access = secret access). The Free tier allows 10
   private repos (up from 1); public repos remain unlimited everywhere.
3. **Paid plans are sold org-only going forward.** Personal accounts stay on
   `free`; a follow-up change retires the personal checkout path. Migration
   `0044` resets personal plans to `free` **except** accounts with a Stripe
   customer, which fold into a valid paid tier (`pro` → `team`) so an active
   subscription is never divorced from its entitlements while it is wound down.
4. **Lapsed trials are normalized.** Orgs whose trial expired unconverted (no
   Stripe customer) previously kept the granted plan in the DB while their
   effective plan was already `free`; migration `0044` aligns the stored value.
   Org `team`/`business` plans granted manually (no Stripe customer, no trial)
   are deliberately kept; residual org `pro` rows follow the Stripe rule above.
5. **Stripe remains the source of truth for amounts** via `lookup_key`
   (`team_*_eur`, `business_*_eur`); the `pro_*` lookup keys are retired and the
   reverse lookup map is now derived from the forward one. Feature gating is
   unchanged: hierarchical, fail-closed, `hasExposureAccess` at `business`.

## Consequences

- Migration `0044` must run **before** the new backend deploys: rows still
  carrying `pro` would make `PLANS['pro']` lookups throw at runtime.
- The prices endpoint no longer returns a `pro` entry — deployed clients must
  tolerate its absence before this ships (dashboard: #23).
- The four `team_*`/`business_*` lookup keys must exist in Stripe (Test and
  Live) before deploy; `pro_*` prices can be archived afterwards.
- Webhooks for legacy `pro_*`-priced subscriptions no longer resolve to a plan
  and are dropped with a warning. No such live subscriptions exist today — the
  migration's `pro`→`team` fold is purely defensive — and the personal-checkout
  retirement handles anything that would remain.

## Notes

Product/go-to-market rationale (positioning, amounts, pricing strategy) is
maintained separately, outside this repository, per ADR 0001.
