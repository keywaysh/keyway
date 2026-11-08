import { describe, it, expect, vi } from 'vitest';

const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('../src/db', () => ({
  db: { select, query: {} },
}));

import { getVaultPermissions } from '../src/utils/permissions';

describe('legacy environment_permissions rules', () => {
  it('are not listed as active custom rules: access checks never apply them', async () => {
    select.mockReturnValue({
      from: () => ({
        where: async () => [
          { vaultId: 'v', environment: 'production', permissionType: 'read', minRole: 'admin' },
        ],
      }),
    });

    const result = await getVaultPermissions('v');

    expect(result.custom).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });
});
