import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  query: {
    permissionOverrides: { findMany: vi.fn(), findFirst: vi.fn() },
    vaultEnvironments: { findMany: vi.fn(), findFirst: vi.fn() },
    vaults: { findFirst: vi.fn() },
  },
}));
vi.mock('../src/db', () => ({ db }));

import {
  getEffectivePermissionsForUser,
  resolveEffectivePermission,
  resolveEffectivePermissions,
} from '../src/utils/permissions';
import { pickApplicableOverride } from '../src/services/permission-override.service';

const override = (o: Record<string, unknown>) => ({
  id: String(Math.random()),
  vaultId: 'v',
  canRead: true,
  canWrite: false,
  targetUserId: null,
  targetRole: null,
  ...o,
});

describe('pickApplicableOverride (precedence)', () => {
  const userExact = override({ targetType: 'user', targetUserId: 'u', environment: 'production', canRead: true });
  const userWild = override({ targetType: 'user', targetUserId: 'u', environment: '*', canRead: false });
  const roleExact = override({ targetType: 'role', targetRole: 'read', environment: 'production' });
  const roleWild = override({ targetType: 'role', targetRole: 'read', environment: '*' });
  const otherUser = override({ targetType: 'user', targetUserId: 'someone-else', environment: 'production' });
  const otherRole = override({ targetType: 'role', targetRole: 'admin', environment: 'production' });

  it('user exact > user wildcard > role exact > role wildcard', () => {
    const all = [roleWild, roleExact, userWild, userExact];
    expect(pickApplicableOverride(all, 'production', 'u', 'read')).toBe(userExact);
    expect(pickApplicableOverride([roleWild, roleExact, userWild], 'production', 'u', 'read')).toBe(userWild);
    expect(pickApplicableOverride([roleWild, roleExact], 'production', 'u', 'read')).toBe(roleExact);
    expect(pickApplicableOverride([roleWild], 'production', 'u', 'read')).toBe(roleWild);
  });

  it('ignores overrides for other users, other roles and other environments', () => {
    const staging = override({ targetType: 'user', targetUserId: 'u', environment: 'staging' });
    expect(pickApplicableOverride([otherUser, otherRole, staging], 'production', 'u', 'read')).toBeNull();
  });
});

describe('resolveEffectivePermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.query.permissionOverrides.findMany.mockResolvedValue([]);
    db.query.vaultEnvironments.findMany.mockResolvedValue([]);
    db.query.vaults.findFirst.mockResolvedValue({ id: 'v', organization: null });
  });

  it('resolves many environments with a fixed number of queries', async () => {
    const result = await resolveEffectivePermissions(
      'v',
      ['development', 'staging', 'production', 'preview', 'qa', 'main'],
      'u',
      'read',
      'read'
    );

    expect(result).toEqual({
      development: true,
      staging: true,
      production: false,
      preview: true,
      qa: true,
      main: false,
    });
    expect(db.query.permissionOverrides.findMany).toHaveBeenCalledTimes(1);
    expect(db.query.vaultEnvironments.findMany).toHaveBeenCalledTimes(1);
    expect(db.query.vaults.findFirst).toHaveBeenCalledTimes(1);
  });

  it('uses the stored environment type before the name-based guess', async () => {
    db.query.vaultEnvironments.findMany.mockResolvedValue([{ name: 'live', type: 'protected' }]);

    expect(await resolveEffectivePermissions('v', ['live'], 'u', 'read', 'read')).toEqual({
      live: false,
    });
  });

  it('applies org defaults over global defaults, and overrides over both', async () => {
    db.query.vaults.findFirst.mockResolvedValue({
      id: 'v',
      organization: { defaultPermissions: { read: { standard: { read: false, write: false } } } },
    });
    db.query.permissionOverrides.findMany.mockResolvedValue([
      override({ targetType: 'user', targetUserId: 'u', environment: 'qa', canRead: true }),
    ]);

    expect(await resolveEffectivePermissions('v', ['staging', 'qa'], 'u', 'read', 'read')).toEqual({
      staging: false,
      qa: true,
    });
  });

  it('gives the same answer as the single-environment resolver', async () => {
    db.query.permissionOverrides.findMany.mockResolvedValue([
      override({ targetType: 'role', targetRole: 'write', environment: 'production', canWrite: true }),
    ]);

    expect(await resolveEffectivePermission('v', 'production', 'u', 'write', 'write')).toBe(true);
    expect(await resolveEffectivePermission('v', 'staging', 'u', 'read', 'write')).toBe(false);
  });

  it('builds the read/write matrix without per-environment queries', async () => {
    const matrix = await getEffectivePermissionsForUser('v', 'u', 'write', [
      'development',
      'staging',
      'production',
    ]);

    expect(matrix).toEqual({
      development: { read: true, write: true },
      staging: { read: true, write: true },
      production: { read: true, write: false },
    });
    expect(db.query.permissionOverrides.findMany.mock.calls.length).toBeLessThanOrEqual(2);
    expect(db.query.vaults.findFirst.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
