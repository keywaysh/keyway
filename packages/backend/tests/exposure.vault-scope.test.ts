import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

/**
 * Regression: the access history of a secret must be scoped to the vault in
 * the URL. Filtering on secretId alone let an owner of vault A read who
 * accessed a secret of vault B (usernames, roles, platforms, timestamps).
 */

const mocks = vi.hoisted(() => ({
  countWhere: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('../src/db', async () => {
  const schema = await vi.importActual<typeof import('../src/db/schema')>('../src/db/schema');
  return {
    db: {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: mocks.countWhere })) })),
      query: { secretAccesses: { findMany: mocks.findMany } },
    },
    secretAccesses: schema.secretAccesses,
    vaults: schema.vaults,
  };
});

import { getSecretAccessHistory } from '../src/services/exposure.service';

const dialect = new PgDialect();

const SECRET_ID = '22222222-2222-2222-2222-222222222222';
const VAULT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function expectScoped(where: SQL) {
  const { sql, params } = dialect.sqlToQuery(where);
  expect(sql).toContain('"secret_accesses"."secret_id"');
  expect(sql).toContain('"secret_accesses"."vault_id"');
  expect(params).toEqual(expect.arrayContaining([SECRET_ID, VAULT_A]));
}

describe('getSecretAccessHistory — vault scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countWhere.mockResolvedValue([{ count: 0 }]);
    mocks.findMany.mockResolvedValue([]);
  });

  it('scopes the count query to the vault', async () => {
    await getSecretAccessHistory(SECRET_ID, VAULT_A, { limit: 10, offset: 0 });
    expectScoped(mocks.countWhere.mock.calls[0][0]);
  });

  it('scopes the list query to the vault', async () => {
    await getSecretAccessHistory(SECRET_ID, VAULT_A, { limit: 10, offset: 5 });
    const args = mocks.findMany.mock.calls[0][0];
    expectScoped(args.where);
    expect(args.limit).toBe(10);
    expect(args.offset).toBe(5);
  });
});
