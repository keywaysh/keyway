import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

/**
 * Regression: override lookup/update/delete by id must be scoped to the
 * vault in the URL, otherwise an admin of vault A can rewrite or delete an
 * override of vault B by guessing/learning its UUID.
 *
 * The real table definitions are used so the captured WHERE clause can be
 * rendered to SQL and inspected.
 */

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateWhere: vi.fn(),
  deleteWhere: vi.fn(),
}));

vi.mock('../../src/db', async () => {
  const schema = await vi.importActual<typeof import('../../src/db/schema')>('../../src/db/schema');
  return {
    db: {
      query: { permissionOverrides: { findFirst: mocks.findFirst, findMany: vi.fn() } },
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: mocks.updateWhere })) })),
      delete: vi.fn(() => ({ where: mocks.deleteWhere })),
      insert: vi.fn(),
    },
    permissionOverrides: schema.permissionOverrides,
  };
});

import {
  getOverrideById,
  updateOverride,
  deleteOverride,
} from '../../src/services/permission-override.service';

const dialect = new PgDialect();
const render = (where: SQL) => dialect.sqlToQuery(where);

const OVERRIDE_ID = '11111111-1111-1111-1111-111111111111';
const VAULT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function expectScoped(where: SQL) {
  const { sql, params } = render(where);
  expect(sql).toContain('"permission_overrides"."id"');
  expect(sql).toContain('"permission_overrides"."vault_id"');
  expect(params).toEqual(expect.arrayContaining([OVERRIDE_ID, VAULT_A]));
}

describe('permission override service — vault scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateWhere.mockReturnValue({ returning: vi.fn().mockResolvedValue([]) });
    mocks.deleteWhere.mockReturnValue({ returning: vi.fn().mockResolvedValue([]) });
    mocks.findFirst.mockResolvedValue(undefined);
  });

  it('getOverrideById filters on both id and vaultId', async () => {
    await getOverrideById(OVERRIDE_ID, VAULT_A);
    expectScoped(mocks.findFirst.mock.calls[0][0].where);
  });

  it('updateOverride filters on both id and vaultId', async () => {
    await updateOverride(OVERRIDE_ID, VAULT_A, { canWrite: true });
    expectScoped(mocks.updateWhere.mock.calls[0][0]);
  });

  it('updateOverride returns null when nothing in this vault matched', async () => {
    const result = await updateOverride(OVERRIDE_ID, VAULT_A, { canWrite: true });
    expect(result).toBeNull();
  });

  it('deleteOverride filters on both id and vaultId', async () => {
    await deleteOverride(OVERRIDE_ID, VAULT_A);
    expectScoped(mocks.deleteWhere.mock.calls[0][0]);
  });
});
