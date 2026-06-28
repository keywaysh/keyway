# 1. Pricing & plan model

- **Status:** Accepted
- **Date:** 2026-06-27
- **PR:** #22

## Context

The plan/pricing implementation had drifted: currency was inconsistent between
code and UI, per-price Stripe IDs were stored in env vars (which differ between
Test and Live), the tier names were inconsistent, and a collaborator limit was
defined but never enforced. This ADR records how plans, limits, and Stripe
billing are modelled in code.

## Decision

1. **Tiers:** `Free` · `Pro` · `Team` · `Business` (the former `startup` tier was
   renamed `business`; enum migration `0043` renames the value in place).
2. **Limits are flat per tier; the only scaling lever is private repos** — Free 1,
   Pro 10, Team 20, Business 50. There is no per-seat or collaborator/member cap;
   `maxCollaboratorsPerVault` was removed. Currency is EUR.
3. **Feature gating is hierarchical and fail-closed.** `planRank()` /
   `hasExposureAccess()` (`>= business`) gate the advanced feature (Exposure /
   secret-access tracking) on every access-tracking route, with the ownership
   check performed before the plan gate.
4. **Stripe is the source of truth for amounts.** Prices are resolved at runtime
   via `lookup_key` (`pro_*`, `team_*`, `business_*_eur`), which are identical
   across Test and Live; `STRIPE_PRICE_*` env vars were removed. `toResolvedPrice`
   only surfaces a recurring per-unit price on the expected interval.
5. **Organizations** subscribe to Team or Business; a trial grants the Business
   tier. Org checkout is guarded against creating a second subscription (route
   check on plan state plus an authoritative Stripe `subscriptions.list` lookup;
   active trials may still convert).

## Consequences

- Amounts/currency live only in Stripe — re-pricing needs no code change, but the
  six `lookup_key`s must exist in Stripe (Test and Live) before deploy, and
  migration `0043` must run with/before the backend.
- Exposure / per-secret access-history is now gated at `business`. Accounts below
  that tier (including ones that previously reached the per-secret history) lose
  access — a behaviour change to account for at rollout.
- Team/Business are purchasable by individuals as well as organizations, so the
  repo-scaling lever works for personal accounts without an org migration.

## Notes

Product/go-to-market rationale (positioning, segmentation, pricing strategy) is
maintained separately, outside this repository.
