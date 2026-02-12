import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getDefaultPermission,
  canSyncBetweenEnvironments,
  DEFAULT_ROLE_PERMISSIONS,
  getEnvironmentType,
} from '../src/utils/permissions';
import type { CollaboratorRole, PermissionType } from '../src/db/schema';

// Test pure functions without DB
describe('Permissions Utils (Security Critical)', () => {
  describe('getDefaultPermission', () => {
    describe('protected environments (production)', () => {
      const protectedEnvs = ['production', 'prod', 'main', 'master', 'PRODUCTION', 'Prod'];

      protectedEnvs.forEach((env) => {
        it(`should require 'write' role to read from ${env}`, () => {
          const minRole = getDefaultPermission(env, 'read');
          expect(minRole).toBe('write');
        });

        it(`should require 'admin' role to write to ${env}`, () => {
          const minRole = getDefaultPermission(env, 'write');
          expect(minRole).toBe('admin');
        });
      });
    });

    describe('standard environments (staging, test)', () => {
      const standardEnvs = ['staging', 'test', 'qa', 'uat', 'preview'];

      standardEnvs.forEach((env) => {
        it(`should require 'read' role to read from ${env}`, () => {
          const minRole = getDefaultPermission(env, 'read');
          expect(minRole).toBe('read');
        });

        it(`should require 'write' role to write to ${env}`, () => {
          const minRole = getDefaultPermission(env, 'write');
          expect(minRole).toBe('write');
        });
      });
    });

    describe('development environments', () => {
      const devEnvs = ['dev', 'development', 'local', 'DEV', 'Development'];

      devEnvs.forEach((env) => {
        it(`should require 'read' role to read from ${env}`, () => {
          const minRole = getDefaultPermission(env, 'read');
          expect(minRole).toBe('read');
        });

        it(`should require 'read' role to write to ${env} (permissive)`, () => {
          const minRole = getDefaultPermission(env, 'write');
          expect(minRole).toBe('read');
        });
      });
    });

    describe('default environment', () => {
      it('should treat "default" as standard environment', () => {
        expect(getDefaultPermission('default', 'read')).toBe('read');
        expect(getDefaultPermission('default', 'write')).toBe('write');
      });
    });
  });

  describe('Role hierarchy validation', () => {
    const roles: CollaboratorRole[] = ['read', 'triage', 'write', 'maintain', 'admin'];

    it('should have correct role order', () => {
      // admin > maintain > write > triage > read
      expect(roles.indexOf('admin')).toBeGreaterThan(roles.indexOf('maintain'));
      expect(roles.indexOf('maintain')).toBeGreaterThan(roles.indexOf('write'));
      expect(roles.indexOf('write')).toBeGreaterThan(roles.indexOf('triage'));
      expect(roles.indexOf('triage')).toBeGreaterThan(roles.indexOf('read'));
    });
  });

  describe('Security scenarios', () => {
    it('should protect production from read-only users', () => {
      const minReadRole = getDefaultPermission('production', 'read');
      // read and triage users should NOT be able to read production
      expect(['read', 'triage'].includes(minReadRole)).toBe(false);
    });

    it('should protect production from write users for writes', () => {
      const minWriteRole = getDefaultPermission('production', 'write');
      // Only admin can write to production by default
      expect(minWriteRole).toBe('admin');
    });

    it('should allow developers full access to dev environments', () => {
      // Even read-only collaborators can write to dev (permissive for development)
      expect(getDefaultPermission('dev', 'write')).toBe('read');
      expect(getDefaultPermission('local', 'write')).toBe('read');
    });

    it('should handle case-insensitive environment names', () => {
      expect(getDefaultPermission('PRODUCTION', 'write')).toBe('admin');
      expect(getDefaultPermission('Production', 'write')).toBe('admin');
      expect(getDefaultPermission('DEV', 'write')).toBe('read');
    });

    it('should default unknown environments to standard permissions', () => {
      // Unknown environments should be treated as standard (not permissive)
      expect(getDefaultPermission('custom-env', 'read')).toBe('read');
      expect(getDefaultPermission('custom-env', 'write')).toBe('write');
      expect(getDefaultPermission('my-feature-branch', 'write')).toBe('write');
    });
  });
});

describe('Role hierarchy logic', () => {
  // Simulate the roleHasLevel function logic for testing
  const ROLE_HIERARCHY: CollaboratorRole[] = ['read', 'triage', 'write', 'maintain', 'admin'];

  function roleHasLevel(userRole: CollaboratorRole, requiredRole: CollaboratorRole): boolean {
    const userLevel = ROLE_HIERARCHY.indexOf(userRole);
    const requiredLevel = ROLE_HIERARCHY.indexOf(requiredRole);
    return userLevel >= requiredLevel;
  }

  describe('roleHasLevel', () => {
    it('admin should have all permissions', () => {
      expect(roleHasLevel('admin', 'admin')).toBe(true);
      expect(roleHasLevel('admin', 'maintain')).toBe(true);
      expect(roleHasLevel('admin', 'write')).toBe(true);
      expect(roleHasLevel('admin', 'triage')).toBe(true);
      expect(roleHasLevel('admin', 'read')).toBe(true);
    });

    it('maintain should have maintain and below', () => {
      expect(roleHasLevel('maintain', 'admin')).toBe(false);
      expect(roleHasLevel('maintain', 'maintain')).toBe(true);
      expect(roleHasLevel('maintain', 'write')).toBe(true);
      expect(roleHasLevel('maintain', 'triage')).toBe(true);
      expect(roleHasLevel('maintain', 'read')).toBe(true);
    });

    it('write should have write and below', () => {
      expect(roleHasLevel('write', 'admin')).toBe(false);
      expect(roleHasLevel('write', 'maintain')).toBe(false);
      expect(roleHasLevel('write', 'write')).toBe(true);
      expect(roleHasLevel('write', 'triage')).toBe(true);
      expect(roleHasLevel('write', 'read')).toBe(true);
    });

    it('triage should have triage and below', () => {
      expect(roleHasLevel('triage', 'admin')).toBe(false);
      expect(roleHasLevel('triage', 'maintain')).toBe(false);
      expect(roleHasLevel('triage', 'write')).toBe(false);
      expect(roleHasLevel('triage', 'triage')).toBe(true);
      expect(roleHasLevel('triage', 'read')).toBe(true);
    });

    it('read should only have read', () => {
      expect(roleHasLevel('read', 'admin')).toBe(false);
      expect(roleHasLevel('read', 'maintain')).toBe(false);
      expect(roleHasLevel('read', 'write')).toBe(false);
      expect(roleHasLevel('read', 'triage')).toBe(false);
      expect(roleHasLevel('read', 'read')).toBe(true);
    });
  });

  describe('Production access matrix', () => {
    it('should deny read-only users from reading production', () => {
      const requiredRead = 'write'; // getDefaultPermission('production', 'read')
      expect(roleHasLevel('read', requiredRead)).toBe(false);
      expect(roleHasLevel('triage', requiredRead)).toBe(false);
    });

    it('should allow write+ users to read production', () => {
      const requiredRead = 'write';
      expect(roleHasLevel('write', requiredRead)).toBe(true);
      expect(roleHasLevel('maintain', requiredRead)).toBe(true);
      expect(roleHasLevel('admin', requiredRead)).toBe(true);
    });

    it('should only allow admin to write to production', () => {
      const requiredWrite = 'admin'; // getDefaultPermission('production', 'write')
      expect(roleHasLevel('read', requiredWrite)).toBe(false);
      expect(roleHasLevel('triage', requiredWrite)).toBe(false);
      expect(roleHasLevel('write', requiredWrite)).toBe(false);
      expect(roleHasLevel('maintain', requiredWrite)).toBe(false);
      expect(roleHasLevel('admin', requiredWrite)).toBe(true);
    });
  });
});

describe('DEFAULT_ROLE_PERMISSIONS matrix', () => {
  describe('triage role', () => {
    it('should be read-only on all environments', () => {
      // Triage is for issue/PR management, not secrets management
      expect(DEFAULT_ROLE_PERMISSIONS.triage.development.write).toBe(false);
      expect(DEFAULT_ROLE_PERMISSIONS.triage.standard.write).toBe(false);
      expect(DEFAULT_ROLE_PERMISSIONS.triage.protected.write).toBe(false);
    });

    it('should have read access to development and standard', () => {
      expect(DEFAULT_ROLE_PERMISSIONS.triage.development.read).toBe(true);
      expect(DEFAULT_ROLE_PERMISSIONS.triage.standard.read).toBe(true);
    });

    it('should NOT have read access to production', () => {
      expect(DEFAULT_ROLE_PERMISSIONS.triage.protected.read).toBe(false);
    });
  });

  describe('read role', () => {
    it('should be read-only everywhere', () => {
      expect(DEFAULT_ROLE_PERMISSIONS.read.development.write).toBe(false);
      expect(DEFAULT_ROLE_PERMISSIONS.read.standard.write).toBe(false);
      expect(DEFAULT_ROLE_PERMISSIONS.read.protected.write).toBe(false);
    });
  });

  describe('write role', () => {
    it('should have write on development and standard', () => {
      expect(DEFAULT_ROLE_PERMISSIONS.write.development.write).toBe(true);
      expect(DEFAULT_ROLE_PERMISSIONS.write.standard.write).toBe(true);
    });

    it('should be read-only on production', () => {
      expect(DEFAULT_ROLE_PERMISSIONS.write.protected.read).toBe(true);
      expect(DEFAULT_ROLE_PERMISSIONS.write.protected.write).toBe(false);
    });
  });

  describe('maintain role', () => {
    it('should have same permissions as write role', () => {
      expect(DEFAULT_ROLE_PERMISSIONS.maintain.development).toEqual(
        DEFAULT_ROLE_PERMISSIONS.write.development
      );
      expect(DEFAULT_ROLE_PERMISSIONS.maintain.standard).toEqual(
        DEFAULT_ROLE_PERMISSIONS.write.standard
      );
      expect(DEFAULT_ROLE_PERMISSIONS.maintain.protected).toEqual(
        DEFAULT_ROLE_PERMISSIONS.write.protected
      );
    });
  });

  describe('admin role', () => {
    it('should have full access everywhere', () => {
      expect(DEFAULT_ROLE_PERMISSIONS.admin.development).toEqual({ read: true, write: true });
      expect(DEFAULT_ROLE_PERMISSIONS.admin.standard).toEqual({ read: true, write: true });
      expect(DEFAULT_ROLE_PERMISSIONS.admin.protected).toEqual({ read: true, write: true });
    });
  });
});

describe('Cross-environment sync validation', () => {
  describe('canSyncBetweenEnvironments', () => {
    describe('escalating protection levels', () => {
      it('should block dev → staging for non-admin', () => {
        const result = canSyncBetweenEnvironments('development', 'staging', 'write');
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('requires admin role');
      });

      it('should block dev → production for non-admin', () => {
        const result = canSyncBetweenEnvironments('development', 'production', 'write');
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('requires admin role');
      });

      it('should block staging → production for non-admin', () => {
        const result = canSyncBetweenEnvironments('staging', 'production', 'maintain');
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('requires admin role');
      });

      it('should allow admin for any escalation', () => {
        expect(canSyncBetweenEnvironments('development', 'production', 'admin').allowed).toBe(true);
        expect(canSyncBetweenEnvironments('development', 'staging', 'admin').allowed).toBe(true);
        expect(canSyncBetweenEnvironments('staging', 'production', 'admin').allowed).toBe(true);
      });
    });

    describe('same protection level', () => {
      it('should allow staging → staging for write+ roles', () => {
        expect(canSyncBetweenEnvironments('staging', 'test', 'write').allowed).toBe(true);
        expect(canSyncBetweenEnvironments('qa', 'uat', 'maintain').allowed).toBe(true);
      });

      it('should allow production → production for write+ roles', () => {
        expect(canSyncBetweenEnvironments('production', 'prod', 'write').allowed).toBe(true);
      });

      it('should allow dev → dev for write+ roles', () => {
        expect(canSyncBetweenEnvironments('development', 'local', 'write').allowed).toBe(true);
      });
    });

    describe('de-escalating protection levels', () => {
      it('should allow production → staging for write+ roles', () => {
        expect(canSyncBetweenEnvironments('production', 'staging', 'write').allowed).toBe(true);
        expect(canSyncBetweenEnvironments('production', 'staging', 'maintain').allowed).toBe(true);
      });

      it('should allow production → development for write+ roles', () => {
        expect(canSyncBetweenEnvironments('production', 'development', 'write').allowed).toBe(true);
      });

      it('should allow staging → development for write+ roles', () => {
        expect(canSyncBetweenEnvironments('staging', 'development', 'write').allowed).toBe(true);
      });
    });

    describe('role restrictions', () => {
      it('should block escalation for triage role', () => {
        expect(canSyncBetweenEnvironments('development', 'staging', 'triage').allowed).toBe(false);
        expect(canSyncBetweenEnvironments('staging', 'production', 'triage').allowed).toBe(false);
      });

      it('should block escalation for read role', () => {
        expect(canSyncBetweenEnvironments('development', 'staging', 'read').allowed).toBe(false);
        expect(canSyncBetweenEnvironments('development', 'production', 'read').allowed).toBe(false);
      });
    });
  });

  describe('getEnvironmentType classification', () => {
    it('should classify production environments as protected', () => {
      expect(getEnvironmentType('production')).toBe('protected');
      expect(getEnvironmentType('prod')).toBe('protected');
      expect(getEnvironmentType('main')).toBe('protected');
      expect(getEnvironmentType('master')).toBe('protected');
      expect(getEnvironmentType('PRODUCTION')).toBe('protected');
    });

    it('should classify development environments', () => {
      expect(getEnvironmentType('development')).toBe('development');
      expect(getEnvironmentType('dev')).toBe('development');
      expect(getEnvironmentType('local')).toBe('development');
      expect(getEnvironmentType('DEV')).toBe('development');
    });

    it('should classify staging/test as standard', () => {
      expect(getEnvironmentType('staging')).toBe('standard');
      expect(getEnvironmentType('test')).toBe('standard');
      expect(getEnvironmentType('qa')).toBe('standard');
      expect(getEnvironmentType('uat')).toBe('standard');
    });

    it('should default unknown environments to standard', () => {
      expect(getEnvironmentType('feature-branch')).toBe('standard');
      expect(getEnvironmentType('preview-123')).toBe('standard');
    });

    it('should handle Railway serviceId format (env:serviceId)', () => {
      // Railway appends serviceId with colon - must still detect protection level
      expect(getEnvironmentType('production:service-123')).toBe('protected');
      expect(getEnvironmentType('prod:abc-def-456')).toBe('protected');
      expect(getEnvironmentType('staging:service-id')).toBe('standard');
      expect(getEnvironmentType('development:local-svc')).toBe('development');
      expect(getEnvironmentType('dev:my-service')).toBe('development');
    });

    it('should handle multiple colons in serviceId', () => {
      // Edge case: serviceId might contain colons
      expect(getEnvironmentType('production:svc:with:colons')).toBe('protected');
      expect(getEnvironmentType('dev:a:b:c')).toBe('development');
    });
  });
});
