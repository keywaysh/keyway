import { describe, it, expect } from 'vitest';
import {
  REPO_FULL_NAME_PATTERN,
  ENVIRONMENT_NAME_PATTERN,
  repoFullNameSchema,
  environmentNameSchema,
} from '../src/types';

describe('Validation Patterns', () => {
  describe('REPO_FULL_NAME_PATTERN', () => {
    const validNames = [
      'owner/repo',
      'my-org/my-repo',
      'user_name/repo_name',
      'Company.Inc/Project.Name',
      'a/b',
      'org123/repo456',
      'UPPERCASE/REPO',
      'mix.ed-case_123/repo.name-test_1',
    ];

    const invalidNames = [
      'owner',
      'owner/',
      '/repo',
      'owner/repo/extra',
      'owner//repo',
      '',
      'owner/repo name',
      'owner repo/name',
      '@owner/repo',
      'owner/repo!',
    ];

    validNames.forEach((name) => {
      it(`should accept valid repo name: ${name}`, () => {
        expect(REPO_FULL_NAME_PATTERN.test(name)).toBe(true);
      });
    });

    invalidNames.forEach((name) => {
      it(`should reject invalid repo name: ${name || '(empty)'}`, () => {
        expect(REPO_FULL_NAME_PATTERN.test(name)).toBe(false);
      });
    });
  });

  describe('ENVIRONMENT_NAME_PATTERN', () => {
    const validNames = [
      'default',
      'production',
      'staging',
      'dev',
      'test-env',
      'env_name',
      'prod.us-east-1',
      'ENV123',
    ];

    const invalidNames = [
      '',
      'env name',
      'env@name',
      'env/name',
      'env!',
    ];

    validNames.forEach((name) => {
      it(`should accept valid environment: ${name}`, () => {
        expect(ENVIRONMENT_NAME_PATTERN.test(name)).toBe(true);
      });
    });

    invalidNames.forEach((name) => {
      it(`should reject invalid environment: ${name || '(empty)'}`, () => {
        expect(ENVIRONMENT_NAME_PATTERN.test(name)).toBe(false);
      });
    });
  });

  describe('repoFullNameSchema', () => {
    it('should parse valid repo names', () => {
      expect(repoFullNameSchema.parse('owner/repo')).toBe('owner/repo');
      expect(repoFullNameSchema.parse('my-org/my.repo')).toBe('my-org/my.repo');
    });

    it('should throw on invalid repo names', () => {
      expect(() => repoFullNameSchema.parse('invalid')).toThrow();
      expect(() => repoFullNameSchema.parse('')).toThrow();
    });

    it('should provide helpful error message', () => {
      try {
        repoFullNameSchema.parse('invalid');
      } catch (e: any) {
        expect(e.errors[0].message).toContain('owner/repo');
      }
    });
  });

  describe('environmentNameSchema', () => {
    it('should parse valid environment names', () => {
      expect(environmentNameSchema.parse('production')).toBe('production');
      expect(environmentNameSchema.parse('staging-1')).toBe('staging-1');
    });

    it('should throw on invalid environment names', () => {
      expect(() => environmentNameSchema.parse('env name')).toThrow();
      expect(() => environmentNameSchema.parse('')).toThrow();
    });
  });
});
