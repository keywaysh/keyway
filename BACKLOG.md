# Backlog — org members & local dev (session 2026-06-16)

Working notes so we don't forget. Legend: ✅ done · 🔜 todo · 🤔 needs decision.

---

## ✅ Followup PR (post-#18) — resolved here

- **P0 security**: CSP `unsafe-eval` scoped to dev; auth-callback error normalization via `Object.hasOwn`; Topbar feedback `aria-label`.
- **P1 authz**: owner-gated endpoints (sync/billing/trial) now authorize via **live GitHub admin** (`requireLiveOrgAdmin`, fail-closed + self-heal) — closes the bootstrap deadlock (#4) and the stale-DB-role over-authorization.
- **P2 UX**: ConnectOrgModal now lists connectable orgs and calls `POST /orgs/connect` (was install-only / dead-end #3).
- **P3 DX**: dashboard API URL defaults to localhost in dev; `make doctor` (`scripts/doctor.sh`); `CONTRIBUTING.md`; `.env.example` clarifications.
- **P4 polish**: `migrate.ts` console lint (eslint-disable for the CLI script); `unclaimedMemberId` helper centralizes the `github:` sentinel.

### Surfaced by the 3-axis review (DX/security/perennity) — deferred fast-follows
- **CSP `'unsafe-inline'` in prod `script-src`**: bigger XSS-hardening win than `unsafe-eval`, but needs nonce-based CSP (non-trivial with Next.js bootstrap). Separate task.
- **ConnectOrgModal `needs_install` / `contact_admin` statuses**: the modal only renders `ready` orgs; partition by status so members of not-yet-installed orgs get an actionable message (data already on the API).
- **`admin→owner` mapping in the other ~6 sites** (`vaults.routes.ts`, `github.routes.ts`, `github.provider.ts`, …): migrate to `keywayRoleFromGitHub`.
- **`exposure.routes.ts` still authorizes off DB `org_role`** (not live GitHub) — intentional? lower-stakes reads — but document the inconsistency or align it.
- **`doctor.sh` required-env list** is a manual mirror of `config/index.ts` (Zod) — soft-fails on drift; add a cross-ref comment or a backend `--check-env` mode.
- **`getOrganizationDetails` embedded `members[].orgRole`** stays DB-stale while the caller's role self-heals — add a comment that the asymmetry is intentional (members page reads the live roster).

### Deliberately deferred (with reason)
- **`make dev` preflight / honest banner**: editing the large existing `dev` target unsupervised is risky; `make doctor` covers the diagnostic need.
- **Webhook forwarding wiring**: inherently runtime/external (GitHub App webhook URL + tunnel); documented in `CONTRIBUTING.md` rather than hard-wired.
- **`listOrgMembersWithApp` returns `[]` on error**: changing error semantics affects the webhook sync caller; low value, deferred.
- **`getOrganizationDetails` embedded `members[].orgRole` still DB-stale**: low; the members page reads the live roster.
- **Test mocks → shared `tests/helpers/mocks.ts`**: heavy refactor, low value, regression risk; deferred.

---

## ✅ Done this session (in working tree, not yet split into PRs)

- **migrate.ts wait-for-db** retry loop → PR #17 (`fix/migrate-wait-for-db`), CI green, not merged.
- **Org members overlay**: `getOrganizationMembersWithGitHub` reads the live GitHub roster + overlays Keyway status (`onKeyway`, `joinedAt`, "Not on Keyway" badges); `findInstallationForOrg`; DB-only fallback with observable warning.
- **Role from GitHub** (not stale DB) in the members overlay + **dedup by id**.
- **`githubMemberCount`** → dashboard card shows "1/7 on Keyway".  ⚠️ see High-1 below.
- **Members link** card on the org detail page (was orphaned).
- **#1** `listOrgMembers` dedup at source (fixes webhook sync too).
- **#2a** `listUserOrganizations` warns instead of silently defaulting role to `member`.
- **#2b** `/connect` reads role authoritatively via installation token.
- **Self-heal** of the caller's role from live GitHub in `GET /:org`.
- **Docs** `organizations.md`: removed false "syncs when someone accesses a vault" + added the 2 real conditions.

Verified: type-check (backend + dashboard) ✅ · 951 unit tests ✅. Integration-db tests need `keyway_test` (disrupted locally by the native→Docker pg switch; CI is fine).

---

## Code-review findings (agent, 2026-06-16)

> ✅ The 3 High items below were **addressed** after the review:
> - Private-member disclosure → roster now uses the **caller's token** (`getOrganizationMembersWithGitHub(org, accessToken)` → `listOrgMembers(accessToken, login)`).
> - N×3 fan-out → **Option C**: live count removed from the org-list card; the real count stays on the Members page only.
> - Forge guard → `dbByForgeId` now filters `forgeType === "github"` (+ test). `findInstallationForOrg` removed (unused).
>
> Remaining: the Medium/Low/Nits below.

### ✅ High — private-member disclosure via installation token (FIXED — caller token)
- The members roster is fetched with the **App installation token** (Members:Read), which returns **all** org members incl. those with *private* GitHub membership; the route only checks the caller is a **member** (not admin), and that check is against the **stale Keyway DB membership**, not live GitHub.
- **Nuance (my assessment):** on GitHub, *any* org member already sees concealed members, so this is **not** a straight leak for a legit current member. The real risk is narrower: Keyway authorizes via a **stale DB cache** (someone removed from the GitHub org but still in `organization_members` would still see the roster) + uses an **elevated token** for a user-facing read.
- **Fix:** fetch the roster with the **caller's user token** (`listOrgMembers(request.accessToken, login)`) so GitHub's per-user visibility/authorization applies automatically. Removes both the stale-cache risk and the token escalation. (Alt: gate full roster behind a live admin check.)
- Files: `organization.service.ts` `getOrganizationMembersWithGitHub`; `organizations.routes.ts` members route.

### High-1 — N×3 live GitHub fan-out on the org-list page  🤔
- `getOrganizationsForUser` now does `Promise.all` over all the user's orgs, each → `findInstallationForOrg` + install-token mint + **2 paginated** `/members` calls. A user in 15 orgs = ~45+ GitHub calls on one page load, no cache/timeout/concurrency cap → latency + GitHub secondary rate limits.
- **Fix (pick one):** (1) persist `github_member_count` on the org row, refreshed by the member-sync/webhook path, read from DB here (0 extra calls — preferred); (2) cache per-org with a short TTL; (3) at minimum add `p-limit` + per-call timeout.
- The members page already shows the authoritative live roster, so the list-page count should not pay a live cost. **Reconsider whether to keep the live "1/7" on the card as-is.**

### High-2 — dedup/overlay key has no forge guard
- `dbByForgeId` is keyed on `forgeUserId` (text) across a **multi-forge** table, looked up via `String(gm.id)`. Correct for GitHub today, but mis-attributes `onKeyway` if a non-GitHub member row exists or ids collide as strings.
- **Fix:** filter `dbMembers` to `user.forgeType === "github"` (or include forgeType in the key). Add a mixed-forge test.

### Medium
- **Self-heal write-on-GET**: acceptable (idempotent upsert), but only heals the **caller's own** role. Other owner-gated endpoints (`isOrganizationOwner` at sync/billing/etc.) still trust the DB `org_role` → stale until the user hits `GET /:org`. Confirm those call sites are safe.
- **Count `null` conflates empty-org vs no-permission**: `members.length === 0` → `null`. With Members:Read, `0` is a legit answer. Distinguish success-with-0 from failure (root: `listOrgMembersWithApp` swallows errors into `[]`).

### Low / Nits
- `listOrgMembersWithApp` swallows errors into `[]` → callers can't tell empty from failed. Return `null` on error (both new callers try/catch already).
- `#2a` warning fires for legit pending/non-active memberships too → log noise; consider `debug`.
- `getOrganizationDetails` still returns embedded `members[].orgRole` from stale DB (top-level `role` is healed, embedded isn't).
- `` `github:${id}` `` sentinel is a load-bearing format string asserted in tests → extract a shared constant.
- `members/page.tsx` fallback copy uses an inline typographic apostrophe → use `&rsquo;` / constant.

### Test gaps to add
- dedup path (duplicate ids from degraded `?role=`), mixed-forge DB row, empty-org-vs-permission-failure.

---

## 🔜 Known product bugs (identified, not yet fixed)

- **#3 ConnectOrgModal never calls `connect`** — `handleConnectOrg` (→ `POST /orgs/connect`) is wired in the page but the modal only shows an "Install" CTA. In prod the webhook creates the org; locally there's no path → had to call `/orgs/connect` from the browser console. Add an "after install / detected installation → connect" affordance.
- **#4 Member sync is owner-only → bootstrap deadlock** — a user mis-recorded as `member` can't trigger the sync that would fix their role. Mitigated by the self-heal, but the structure remains. Consider: allow a user to refresh their own role anytime, or derive owner authz from live GitHub.

---

## 🔜 Local dev / DX (Tier 1)

The real fix for a night of pain: **no coherent "local dev" profile**, and two undocumented entry points.

1. **Local dev profile prebaked** (`docker-compose.override.yml` or `.env.local.example`) setting the 5 vars we had to find by hand:
   - `DOMAIN=keyway.local`, `CADDYFILE=./Caddyfile`, `DATABASE_URL=…@db:5432/keyway`, `CRYPTO_SERVICE_URL=crypto:50051`, `GITHUB_APP_NAME=<real slug>`
2. **One documented entry point** — `make docker`/Caddy is the real one; clarify or retire `make dev` (native), which needs a separate localhost env profile + localhost callback.
3. **`make doctor`** — checks env present, DB/crypto reachable, dashboard→local, domain, GitHub callback. Would have diagnosed tonight in 2s.
4. **Dashboard default** — `NEXT_PUBLIC_KEYWAY_API_URL` should default to `http://localhost:3000` when `NODE_ENV !== production` (currently hardcoded to prod `api.keyway.sh`, `dashboard/lib/env.ts`).
5. **`GITHUB_APP_NAME` default `keyway-app`** → 404 for any self-hoster who doesn't override (`backend/src/config/index.ts`).
6. **`make dev` lies** — prints "All services running!" even when the backend crashed on env validation. Preflight + honest banner.
7. **Webhook forwarding** for local (smee/cloudflared) so `installation` / org-membership events reach the backend (org creation + member sync depend on them).
8. **Get machine-specific config out of the `dev` vault** — `DATABASE_URL` etc. point at Railway/docker hosts; a `keyway pull -e dev` will clobber local overrides.
9. **Test infra**: `tests/setup.ts` hardcodes `postgresql://test:test@localhost:5432/test`; integration-db uses `postgresql://localhost:5432/keyway_test` as the OS user. Fragile across pg setups — make it configurable / provision in the local profile.

---

## PR plan

- **PR-A** org members roster (overlay + dedup + role-from-GitHub + count* + Members UI + tests). *count needs High-1 decision first.
- **PR-B** org role correctness (self-heal `GET /:org` + #2a/#2b).
- **PR-C** docs (`organizations.md`).
- **PR #17** migrate wait-for-db (already up).
- Then: #3, #4, and the Tier 1 items as their own PRs.

⚠️ Working-tree note: `organization.service.ts` and `organizations.routes.ts` are **entangled** with pre-existing security-audit changes → PR extraction needs hunk-level `git add -p`, not file-level.
