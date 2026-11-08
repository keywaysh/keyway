import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * GitHub lets an organization rename, and lets anyone register the released
 * name. Keyway stores organizations with forge_org_id (immutable) and login
 * (reusable, NOT unique in the schema since migration 0035).
 *
 * ensureOrganizationExists (vault creation, /connect) used to return the row
 * holding the LOGIN before looking at GitHub's org id, so a new GitHub org that
 * took a released login was attached to the old tenant — and to its paid plan,
 * Stripe customer and members. The org must be selected by GitHub's id; a row
 * that still holds the login under another id is stale and must give it up so
 * lookups by login can't resolve to it.
 *
 * The db is an in-memory fake that evaluates the drizzle conditions, so the
 * tests check which row a query really selects.
 */

const store = vi.hoisted(() => ({
  orgs: [] as Record<string, unknown>[],
  members: [] as Record<string, unknown>[],
  nextId: 1,
}));

const mocks = vi.hoisted(() => ({
  getGitHubOrgInfoWithToken: vi.fn(),
}));

type Cond =
  | { op: "eq" | "ne"; col: string; val: unknown }
  | { op: "and"; conds: Cond[] }
  | { op: "sql"; text: string; values: unknown[] };

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (col: string, val: unknown) => ({ op: "eq", col, val }),
    ne: (col: string, val: unknown) => ({ op: "ne", col, val }),
    and: (...conds: Cond[]) => ({ op: "and", conds }),
    desc: (col: string) => col,
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      op: "sql",
      text: strings.join("?"),
      values,
    }),
  };
});

vi.mock("../../src/db", async () => {
  // The service imports its tables from db/schema: the conditions carry real
  // drizzle columns, resolved here to the row's field (snake → camel case).
  const schema = await vi.importActual<typeof import("../../src/db/schema")>("../../src/db/schema");
  const field = (col: unknown): string =>
    typeof col === "string"
      ? col
      : (col as { name: string }).name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const matches = (row: Record<string, unknown>, cond: Cond): boolean => {
    switch (cond.op) {
      case "and":
        return cond.conds.every((c) => matches(row, c));
      case "eq":
        return row[field(cond.col)] === cond.val;
      case "ne":
        return row[field(cond.col)] !== cond.val;
      case "sql":
        if (cond.text === "lower(?) = lower(?)") {
          return (
            String(row[field(cond.values[0])]).toLowerCase() === String(cond.values[1]).toLowerCase()
          );
        }
        throw new Error(`fake db: unsupported sql ${cond.text}`);
    }
  };
  const rowsOf = (table: unknown) => {
    if (table === schema.organizations) {
      return store.orgs;
    }
    if (table === schema.organizationMembers) {
      return store.members;
    }
    throw new Error("fake db: unexpected table");
  };
  const prefix = (table: unknown) => (table === schema.organizations ? "org" : "member");
  return {
    db: {
      query: {
        organizations: {
          findFirst: async ({ where }: { where: Cond }) => store.orgs.find((r) => matches(r, where)),
          findMany: async ({ where }: { where: Cond }) => store.orgs.filter((r) => matches(r, where)),
        },
        organizationMembers: {
          findFirst: async ({ where }: { where: Cond }) =>
            store.members.find((r) => matches(r, where)),
        },
      },
      insert: (table: unknown) => ({
        values: (row: Record<string, unknown>) => ({
          returning: async () => {
            const created = { ...row, id: `${prefix(table)}-${store.nextId++}` };
            rowsOf(table).push(created);
            return [created];
          },
        }),
      }),
      update: (table: unknown) => ({
        set: (patch: Record<string, unknown>) => ({
          where: (cond: Cond) => {
            const rows = rowsOf(table).filter((r) => matches(r, cond));
            rows.forEach((r) => Object.assign(r, patch));
            const result = Promise.resolve(undefined);
            return Object.assign(result, { returning: async () => rows.map((r) => ({ ...r })) });
          },
        }),
      }),
    },
  };
});

vi.mock("../../src/utils/github", () => ({
  getGitHubOrgInfoWithToken: mocks.getGitHubOrgInfoWithToken,
  listOrgMembers: vi.fn(),
}));

vi.mock("../../src/services/trial.service", () => ({
  getTrialInfo: vi.fn().mockReturnValue({ status: "none" }),
  TRIAL_DURATION_DAYS: 15,
}));

import {
  ensureOrganizationExists,
  getOrCreateOrganization,
  getOrganizationByLogin,
} from "../../src/services/organization.service";

/** The old tenant: GitHub org 98765, once named acme-corp, on a paid plan. */
const oldAcme = () => ({
  id: "org-old-acme",
  forgeType: "github",
  forgeOrgId: "98765",
  login: "acme-corp",
  displayName: "Acme",
  avatarUrl: null,
  plan: "business",
  stripeCustomerId: "cus_old_acme",
});

/** GitHub org 4242 registered the released name acme-corp. */
const newAcmeOnGitHub = {
  id: 4242,
  login: "acme-corp",
  name: "Not Acme",
  avatar_url: "https://avatars.example/4242",
};

beforeEach(() => {
  store.orgs.length = 0;
  store.members.length = 0;
  store.nextId = 1;
  mocks.getGitHubOrgInfoWithToken.mockReset();
});

describe("ensureOrganizationExists selects the org by GitHub's immutable id", () => {
  it("does not attach a GitHub org that took a released login to the old tenant", async () => {
    store.orgs.push(oldAcme());
    store.members.push({ id: "m-alice", orgId: "org-old-acme", userId: "u-alice", orgRole: "owner" });
    mocks.getGitHubOrgInfoWithToken.mockResolvedValue(newAcmeOnGitHub);

    const org = await ensureOrganizationExists("acme-corp", "install-token", {
      userId: "u-mallory",
      keywayRole: "owner",
    });

    expect(org?.id).not.toBe("org-old-acme");
    expect(org).toMatchObject({ forgeType: "github", forgeOrgId: "4242", login: "acme-corp" });
    // None of the old tenant's paid plan or billing comes along.
    expect(org?.plan).not.toBe("business");
    expect(org?.stripeCustomerId).toBeUndefined();
    // The caller joins the new org only, never the old tenant.
    expect(store.members.filter((m) => m.orgId === "org-old-acme")).toEqual([
      expect.objectContaining({ userId: "u-alice" }),
    ]);
    expect(store.members).toContainEqual(
      expect.objectContaining({ orgId: org?.id, userId: "u-mallory", orgRole: "owner" })
    );
  });

  it("releases the login from the stale row, so login lookups resolve the current org only", async () => {
    store.orgs.push(oldAcme());
    mocks.getGitHubOrgInfoWithToken.mockResolvedValue(newAcmeOnGitHub);

    const org = await ensureOrganizationExists("acme-corp", "install-token");

    const stale = store.orgs.find((o) => o.id === "org-old-acme")!;
    expect(stale.login).not.toBe("acme-corp");
    expect(String(stale.login).toLowerCase()).not.toBe("acme-corp");
    // The old tenant's data is untouched: only the name it no longer holds is released.
    expect(stale).toMatchObject({ forgeOrgId: "98765", plan: "business", stripeCustomerId: "cus_old_acme" });
    expect((await getOrganizationByLogin("acme-corp"))?.id).toBe(org?.id);
  });

  it("releases a stale login that differs only by case (GitHub logins are case-insensitive)", async () => {
    store.orgs.push({ ...oldAcme(), login: "Acme-Corp" });
    mocks.getGitHubOrgInfoWithToken.mockResolvedValue(newAcmeOnGitHub);

    await ensureOrganizationExists("acme-corp", "install-token");

    const stale = store.orgs.find((o) => o.id === "org-old-acme")!;
    expect(String(stale.login).toLowerCase()).not.toBe("acme-corp");
  });

  it("returns the same GitHub org's row, renamed, without creating another", async () => {
    store.orgs.push({ ...oldAcme(), login: "acme-old-name" });
    mocks.getGitHubOrgInfoWithToken.mockResolvedValue({
      id: 98765,
      login: "acme-corp",
      name: "Acme",
      avatar_url: "https://avatars.example/98765",
    });

    const org = await ensureOrganizationExists("acme-corp", "install-token");

    expect(org?.id).toBe("org-old-acme");
    expect(org?.login).toBe("acme-corp");
    expect(store.orgs).toHaveLength(1);
  });

  it("refuses (503) instead of guessing when GitHub can't confirm which org holds a login Keyway knows", async () => {
    store.orgs.push(oldAcme());
    mocks.getGitHubOrgInfoWithToken.mockResolvedValue(null);

    await expect(
      ensureOrganizationExists("acme-corp", "install-token", { userId: "u-mallory", keywayRole: "owner" })
    ).rejects.toMatchObject({ status: 503 });
    expect(store.members).toHaveLength(0);
    expect(store.orgs).toHaveLength(1);
  });

  it("still returns null for a login neither GitHub nor Keyway knows as an org", async () => {
    mocks.getGitHubOrgInfoWithToken.mockResolvedValue(null);

    await expect(ensureOrganizationExists("someone", "install-token")).resolves.toBeNull();
    expect(store.orgs).toHaveLength(0);
  });
});

describe("getOrCreateOrganization (installation webhook) releases a reused login", () => {
  it("creates the new GitHub org's row and takes the login off the stale row", async () => {
    store.orgs.push(oldAcme());

    const org = await getOrCreateOrganization("github", "4242", "acme-corp");

    expect(org).toMatchObject({ forgeOrgId: "4242", login: "acme-corp" });
    expect(org.id).not.toBe("org-old-acme");
    expect(store.orgs.find((o) => o.id === "org-old-acme")!.login).not.toBe("acme-corp");
    expect((await getOrganizationByLogin("acme-corp"))?.id).toBe(org.id);
  });

  it("leaves other orgs' logins alone", async () => {
    store.orgs.push(oldAcme(), { ...oldAcme(), id: "org-globex", forgeOrgId: "555", login: "globex" });

    await getOrCreateOrganization("github", "98765", "acme-corp");

    expect(store.orgs.map((o) => o.login).sort()).toEqual(["acme-corp", "globex"]);
  });
});
