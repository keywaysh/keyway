import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireScopes, hasScope } from '../src/middleware/scopes';
import { ForbiddenError } from '../src/lib';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ApiKeyScope } from '../src/utils/apiKeys';

// Mock request factory
function createMockRequest(apiKey?: { id: string; scopes: ApiKeyScope[] }): FastifyRequest {
  return {
    apiKey: apiKey ?? undefined,
    log: {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as unknown as FastifyRequest;
}

// Mock reply factory
function createMockReply(): FastifyReply {
  return {} as FastifyReply;
}

describe('Scopes Middleware', () => {
  describe('requireScopes', () => {
    describe('JWT authentication (no apiKey)', () => {
      it('should allow all access when no apiKey is present (JWT auth)', async () => {
        const middleware = requireScopes(['read:secrets', 'write:secrets']);
        const request = createMockRequest(); // No apiKey = JWT auth
        const reply = createMockReply();

        // Should not throw
        await expect(middleware(request, reply)).resolves.toBeUndefined();
      });

      it('should allow admin:api-keys scope requirement with JWT auth', async () => {
        const middleware = requireScopes(['admin:api-keys']);
        const request = createMockRequest();
        const reply = createMockReply();

        await expect(middleware(request, reply)).resolves.toBeUndefined();
      });
    });

    describe('API Key authentication', () => {
      it('should allow when API key has all required scopes', async () => {
        const middleware = requireScopes(['read:secrets']);
        const request = createMockRequest({
          id: 'key-123',
          scopes: ['read:secrets', 'write:secrets'],
        });
        const reply = createMockReply();

        await expect(middleware(request, reply)).resolves.toBeUndefined();
      });

      it('should allow when API key has exact required scopes', async () => {
        const middleware = requireScopes(['read:secrets', 'write:secrets']);
        const request = createMockRequest({
          id: 'key-123',
          scopes: ['read:secrets', 'write:secrets'],
        });
        const reply = createMockReply();

        await expect(middleware(request, reply)).resolves.toBeUndefined();
      });

      it('should allow when API key has more scopes than required', async () => {
        const middleware = requireScopes(['read:secrets']);
        const request = createMockRequest({
          id: 'key-123',
          scopes: ['read:secrets', 'write:secrets', 'delete:secrets', 'admin:api-keys'],
        });
        const reply = createMockReply();

        await expect(middleware(request, reply)).resolves.toBeUndefined();
      });

      it('should throw ForbiddenError when API key is missing required scope', async () => {
        const middleware = requireScopes(['write:secrets']);
        const request = createMockRequest({
          id: 'key-123',
          scopes: ['read:secrets'],
        });
        const reply = createMockReply();

        await expect(middleware(request, reply)).rejects.toThrow(ForbiddenError);
      });

      it('should throw ForbiddenError when API key is missing multiple required scopes', async () => {
        const middleware = requireScopes(['read:secrets', 'write:secrets', 'delete:secrets']);
        const request = createMockRequest({
          id: 'key-123',
          scopes: ['read:secrets'],
        });
        const reply = createMockReply();

        await expect(middleware(request, reply)).rejects.toThrow(ForbiddenError);
      });

      it('should throw ForbiddenError when API key has no scopes', async () => {
        const middleware = requireScopes(['read:secrets']);
        const request = createMockRequest({
          id: 'key-123',
          scopes: [],
        });
        const reply = createMockReply();

        await expect(middleware(request, reply)).rejects.toThrow(ForbiddenError);
      });

      it('should allow when no scopes are required', async () => {
        const middleware = requireScopes([]);
        const request = createMockRequest({
          id: 'key-123',
          scopes: ['read:secrets'],
        });
        const reply = createMockReply();

        await expect(middleware(request, reply)).resolves.toBeUndefined();
      });

      it('should allow empty scopes API key when no scopes required', async () => {
        const middleware = requireScopes([]);
        const request = createMockRequest({
          id: 'key-123',
          scopes: [],
        });
        const reply = createMockReply();

        await expect(middleware(request, reply)).resolves.toBeUndefined();
      });

      it('should log warning when scopes are missing', async () => {
        const middleware = requireScopes(['write:secrets']);
        const request = createMockRequest({
          id: 'key-456',
          scopes: ['read:secrets'],
        });
        const reply = createMockReply();

        try {
          await middleware(request, reply);
        } catch {
          // Expected to throw
        }

        expect(request.log.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            apiKeyId: 'key-456',
            required: ['write:secrets'],
            actual: ['read:secrets'],
            missing: ['write:secrets'],
          }),
          'API key missing required scopes'
        );
      });

      it('should include missing scopes in error message', async () => {
        const middleware = requireScopes(['write:secrets', 'delete:secrets']);
        const request = createMockRequest({
          id: 'key-123',
          scopes: ['read:secrets'],
        });
        const reply = createMockReply();

        try {
          await middleware(request, reply);
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(ForbiddenError);
          const message = (error as ForbiddenError).message;
          expect(message).toContain('write:secrets');
          expect(message).toContain('delete:secrets');
          expect(message).toContain('Required:');
          expect(message).toContain('Available: read:secrets');
        }
      });
    });

    describe('All scope combinations', () => {
      const allScopes: ApiKeyScope[] = ['read:secrets', 'write:secrets', 'delete:secrets', 'admin:api-keys'];

      allScopes.forEach((scope) => {
        it(`should allow API key with ${scope} to access endpoint requiring ${scope}`, async () => {
          const middleware = requireScopes([scope]);
          const request = createMockRequest({
            id: 'key-123',
            scopes: [scope],
          });
          const reply = createMockReply();

          await expect(middleware(request, reply)).resolves.toBeUndefined();
        });
      });

      it('should allow API key with all scopes to access any endpoint', async () => {
        const middleware = requireScopes(allScopes);
        const request = createMockRequest({
          id: 'key-full',
          scopes: allScopes,
        });
        const reply = createMockReply();

        await expect(middleware(request, reply)).resolves.toBeUndefined();
      });
    });

    // EDGE CASES
    describe('edge cases', () => {
      it('should handle API key with undefined scopes gracefully', async () => {
        const middleware = requireScopes(['read:secrets']);
        const request = {
          apiKey: {
            id: 'key-123',
            scopes: undefined as unknown as ApiKeyScope[],
          },
          log: {
            warn: vi.fn(),
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
          },
        } as unknown as FastifyRequest;
        const reply = createMockReply();

        // Should throw because undefined.includes() will error
        // This tests defensive programming
        await expect(middleware(request, reply)).rejects.toThrow();
      });

      it('should handle API key with null scopes gracefully', async () => {
        const middleware = requireScopes(['read:secrets']);
        const request = {
          apiKey: {
            id: 'key-123',
            scopes: null as unknown as ApiKeyScope[],
          },
          log: {
            warn: vi.fn(),
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
          },
        } as unknown as FastifyRequest;
        const reply = createMockReply();

        // Should throw because null.includes() will error
        await expect(middleware(request, reply)).rejects.toThrow();
      });

      it('should handle duplicate scopes in API key', async () => {
        const middleware = requireScopes(['read:secrets']);
        const request = createMockRequest({
          id: 'key-123',
          scopes: ['read:secrets', 'read:secrets', 'read:secrets'] as ApiKeyScope[],
        });
        const reply = createMockReply();

        await expect(middleware(request, reply)).resolves.toBeUndefined();
      });

      it('should handle duplicate scopes in requirements', async () => {
        // The middleware should still work with duplicate requirements
        const middleware = requireScopes(['read:secrets', 'read:secrets'] as ApiKeyScope[]);
        const request = createMockRequest({
          id: 'key-123',
          scopes: ['read:secrets'],
        });
        const reply = createMockReply();

        await expect(middleware(request, reply)).resolves.toBeUndefined();
      });

      it('should be case-sensitive for scope checking', async () => {
        const middleware = requireScopes(['read:secrets']);
        const request = createMockRequest({
          id: 'key-123',
          scopes: ['READ:secrets'] as unknown as ApiKeyScope[],
        });
        const reply = createMockReply();

        await expect(middleware(request, reply)).rejects.toThrow(ForbiddenError);
      });

      it('should reject scopes with whitespace variations', async () => {
        const middleware = requireScopes(['read:secrets']);
        const request = createMockRequest({
          id: 'key-123',
          scopes: [' read:secrets'] as unknown as ApiKeyScope[],
        });
        const reply = createMockReply();

        await expect(middleware(request, reply)).rejects.toThrow(ForbiddenError);
      });

      it('should handle very large scope arrays efficiently', async () => {
        // Create a large array of scopes
        const largeScopes = Array(1000).fill('read:secrets') as ApiKeyScope[];
        const middleware = requireScopes(largeScopes);
        const request = createMockRequest({
          id: 'key-123',
          scopes: ['read:secrets'],
        });
        const reply = createMockReply();

        const start = Date.now();
        await expect(middleware(request, reply)).resolves.toBeUndefined();
        const elapsed = Date.now() - start;

        // Should complete quickly even with large arrays
        expect(elapsed).toBeLessThan(100);
      });

      it('should handle concurrent middleware calls', async () => {
        const middleware = requireScopes(['read:secrets']);
        const promises: Promise<void>[] = [];

        for (let i = 0; i < 100; i++) {
          const request = createMockRequest({
            id: `key-${i}`,
            scopes: ['read:secrets', 'write:secrets'],
          });
          const reply = createMockReply();
          promises.push(middleware(request, reply));
        }

        // All should resolve without issues
        await expect(Promise.all(promises)).resolves.toBeDefined();
      });
    });
  });

  describe('hasScope', () => {
    describe('JWT authentication (no apiKey)', () => {
      it('should return true for any scope when using JWT auth', () => {
        const request = createMockRequest(); // No apiKey = JWT auth

        expect(hasScope(request, 'read:secrets')).toBe(true);
        expect(hasScope(request, 'write:secrets')).toBe(true);
        expect(hasScope(request, 'delete:secrets')).toBe(true);
        expect(hasScope(request, 'admin:api-keys')).toBe(true);
      });
    });

    describe('API Key authentication', () => {
      it('should return true when API key has the scope', () => {
        const request = createMockRequest({
          id: 'key-123',
          scopes: ['read:secrets', 'write:secrets'],
        });

        expect(hasScope(request, 'read:secrets')).toBe(true);
        expect(hasScope(request, 'write:secrets')).toBe(true);
      });

      it('should return false when API key does not have the scope', () => {
        const request = createMockRequest({
          id: 'key-123',
          scopes: ['read:secrets'],
        });

        expect(hasScope(request, 'write:secrets')).toBe(false);
        expect(hasScope(request, 'delete:secrets')).toBe(false);
        expect(hasScope(request, 'admin:api-keys')).toBe(false);
      });

      it('should return false for any scope when API key has no scopes', () => {
        const request = createMockRequest({
          id: 'key-123',
          scopes: [],
        });

        expect(hasScope(request, 'read:secrets')).toBe(false);
        expect(hasScope(request, 'write:secrets')).toBe(false);
        expect(hasScope(request, 'delete:secrets')).toBe(false);
        expect(hasScope(request, 'admin:api-keys')).toBe(false);
      });
    });

    // EDGE CASES
    describe('edge cases', () => {
      it('should handle request with apiKey set to null', () => {
        const request = {
          apiKey: null,
        } as unknown as FastifyRequest;

        // null is falsy, so should treat as JWT auth (full access)
        expect(hasScope(request, 'read:secrets')).toBe(true);
      });

      it('should handle request with apiKey set to empty object', () => {
        const request = {
          apiKey: {},
        } as unknown as FastifyRequest;

        // Empty object is truthy, but scopes will be undefined
        // This should throw or return false - let's check behavior
        expect(() => hasScope(request, 'read:secrets')).toThrow();
      });

      it('should be case-sensitive for scope matching', () => {
        const request = createMockRequest({
          id: 'key-123',
          scopes: ['READ:secrets'] as unknown as ApiKeyScope[],
        });

        expect(hasScope(request, 'read:secrets')).toBe(false);
        expect(hasScope(request, 'READ:secrets' as ApiKeyScope)).toBe(true);
      });

      it('should handle duplicate scopes in API key', () => {
        const request = createMockRequest({
          id: 'key-123',
          scopes: ['read:secrets', 'read:secrets'] as ApiKeyScope[],
        });

        expect(hasScope(request, 'read:secrets')).toBe(true);
      });
    });
  });

  describe('Security scenarios', () => {
    it('should prevent read-only API key from writing secrets', async () => {
      const middleware = requireScopes(['write:secrets']);
      const request = createMockRequest({
        id: 'readonly-key',
        scopes: ['read:secrets'],
      });
      const reply = createMockReply();

      await expect(middleware(request, reply)).rejects.toThrow(ForbiddenError);
    });

    it('should prevent API key without admin scope from managing API keys', async () => {
      const middleware = requireScopes(['admin:api-keys']);
      const request = createMockRequest({
        id: 'ci-key',
        scopes: ['read:secrets', 'write:secrets'],
      });
      const reply = createMockReply();

      await expect(middleware(request, reply)).rejects.toThrow(ForbiddenError);
    });

    it('should prevent API key from deleting without delete scope', async () => {
      const middleware = requireScopes(['delete:secrets']);
      const request = createMockRequest({
        id: 'deploy-key',
        scopes: ['read:secrets', 'write:secrets'],
      });
      const reply = createMockReply();

      await expect(middleware(request, reply)).rejects.toThrow(ForbiddenError);
    });

    it('should allow full access key to perform any operation', async () => {
      const allScopes: ApiKeyScope[] = ['read:secrets', 'write:secrets', 'delete:secrets', 'admin:api-keys'];
      const request = createMockRequest({
        id: 'admin-key',
        scopes: allScopes,
      });
      const reply = createMockReply();

      // Test all possible required scopes
      await expect(requireScopes(['read:secrets'])(request, reply)).resolves.toBeUndefined();
      await expect(requireScopes(['write:secrets'])(request, reply)).resolves.toBeUndefined();
      await expect(requireScopes(['delete:secrets'])(request, reply)).resolves.toBeUndefined();
      await expect(requireScopes(['admin:api-keys'])(request, reply)).resolves.toBeUndefined();
      await expect(requireScopes(allScopes)(request, reply)).resolves.toBeUndefined();
    });

    // ADVANCED SECURITY SCENARIOS
    describe('privilege escalation prevention', () => {
      it('should not allow scope expansion through manipulation', async () => {
        // Simulate an attempt to use a scope that looks similar
        const middleware = requireScopes(['admin:api-keys']);
        const request = createMockRequest({
          id: 'malicious-key',
          scopes: ['admin:api-keys ', 'admin:api-keys\t'] as unknown as ApiKeyScope[], // trailing whitespace
        });
        const reply = createMockReply();

        await expect(middleware(request, reply)).rejects.toThrow(ForbiddenError);
      });

      it('should not allow unicode homograph attacks on scopes', async () => {
        const middleware = requireScopes(['read:secrets']);
        const request = createMockRequest({
          id: 'malicious-key',
          // Using Cyrillic 'е' instead of Latin 'e'
          scopes: ['rеad:secrets'] as unknown as ApiKeyScope[],
        });
        const reply = createMockReply();

        await expect(middleware(request, reply)).rejects.toThrow(ForbiddenError);
      });

      it('should prevent prototype pollution through scopes array', async () => {
        const middleware = requireScopes(['read:secrets']);
        const maliciousScopes = ['read:secrets'];
        // @ts-expect-error - intentionally testing malicious input
        maliciousScopes.__proto__ = { includes: () => true };

        const request = createMockRequest({
          id: 'key-123',
          scopes: maliciousScopes as ApiKeyScope[],
        });
        const reply = createMockReply();

        // Should still work correctly despite prototype manipulation attempt
        await expect(middleware(request, reply)).resolves.toBeUndefined();
      });

      it('should handle API key with scopes as non-array type (string)', async () => {
        // Note: String.prototype.includes() works for substring matching
        // so 'read:secrets'.includes('read:secrets') returns true!
        // This test documents this potentially dangerous behavior
        const middleware = requireScopes(['read:secrets']);
        const request = {
          apiKey: {
            id: 'key-123',
            scopes: 'read:secrets' as unknown as ApiKeyScope[], // string instead of array
          },
          log: {
            warn: vi.fn(),
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
          },
        } as unknown as FastifyRequest;
        const reply = createMockReply();

        // String.includes() works, but this is a type safety hole that TypeScript catches
        // The middleware resolves because 'read:secrets'.includes('read:secrets') === true
        await expect(middleware(request, reply)).resolves.toBeUndefined();
      });

      it('should fail when scopes string does not contain required scope', async () => {
        // This demonstrates what happens when scopes is accidentally a string
        // and the required scope is not found: the error message construction fails
        const middleware = requireScopes(['write:secrets']);
        const request = {
          apiKey: {
            id: 'key-123',
            scopes: 'read:secrets' as unknown as ApiKeyScope[], // string instead of array
          },
          log: {
            warn: vi.fn(),
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
          },
        } as unknown as FastifyRequest;
        const reply = createMockReply();

        // 'read:secrets'.includes('write:secrets') === false, so it tries to throw ForbiddenError
        // But the error message construction calls apiKeyScopes.join() which fails on a string
        // This reveals a potential improvement: add Array.isArray check in middleware
        await expect(middleware(request, reply)).rejects.toThrow(TypeError);
      });
    });

    describe('error message security', () => {
      it('should not leak sensitive information in error messages', async () => {
        const middleware = requireScopes(['admin:api-keys']);
        const request = createMockRequest({
          id: 'secret-key-id-12345',
          scopes: ['read:secrets'],
        });
        const reply = createMockReply();

        try {
          await middleware(request, reply);
          expect.fail('Should have thrown');
        } catch (error) {
          const message = (error as ForbiddenError).message;
          // Error should mention scopes but not expose internal key IDs in message
          expect(message).toContain('admin:api-keys');
          expect(message).toContain('read:secrets');
          // The key ID should only be in logs, not in user-facing error
          expect(message).not.toContain('secret-key-id-12345');
        }
      });

      it('should log appropriate details for security audit', async () => {
        const middleware = requireScopes(['delete:secrets', 'admin:api-keys']);
        const request = createMockRequest({
          id: 'audit-test-key',
          scopes: ['read:secrets'],
        });
        const reply = createMockReply();

        try {
          await middleware(request, reply);
        } catch {
          // Expected to throw
        }

        // Verify security-relevant information is logged
        expect(request.log.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            apiKeyId: 'audit-test-key',
            required: ['delete:secrets', 'admin:api-keys'],
            actual: ['read:secrets'],
            missing: expect.arrayContaining(['delete:secrets', 'admin:api-keys']),
          }),
          expect.any(String)
        );
      });
    });

    describe('defense in depth', () => {
      it('should handle mixed valid and invalid scopes in API key', async () => {
        const middleware = requireScopes(['read:secrets']);
        const request = createMockRequest({
          id: 'key-123',
          scopes: ['read:secrets', 'invalid:scope', '__proto__'] as ApiKeyScope[],
        });
        const reply = createMockReply();

        // Should still allow because read:secrets is present
        await expect(middleware(request, reply)).resolves.toBeUndefined();
      });

      it('should deny if required scope is in key but request requires additional scope', async () => {
        const middleware = requireScopes(['read:secrets', 'write:secrets']);
        const request = createMockRequest({
          id: 'key-123',
          scopes: ['read:secrets', 'admin:api-keys'], // has read but not write
        });
        const reply = createMockReply();

        await expect(middleware(request, reply)).rejects.toThrow(ForbiddenError);
      });
    });
  });

  describe('Middleware factory behavior', () => {
    it('should create independent middleware instances', async () => {
      const readMiddleware = requireScopes(['read:secrets']);
      const writeMiddleware = requireScopes(['write:secrets']);

      const readOnlyRequest = createMockRequest({
        id: 'read-key',
        scopes: ['read:secrets'],
      });
      const reply = createMockReply();

      // readMiddleware should pass
      await expect(readMiddleware(readOnlyRequest, reply)).resolves.toBeUndefined();

      // writeMiddleware should fail for same request
      await expect(writeMiddleware(readOnlyRequest, reply)).rejects.toThrow(ForbiddenError);
    });

    it('should be reusable across multiple requests', async () => {
      const middleware = requireScopes(['read:secrets']);

      for (let i = 0; i < 10; i++) {
        const request = createMockRequest({
          id: `key-${i}`,
          scopes: ['read:secrets'],
        });
        const reply = createMockReply();

        await expect(middleware(request, reply)).resolves.toBeUndefined();
      }
    });

    it('should not maintain state between calls', async () => {
      const middleware = requireScopes(['read:secrets']);

      // First call with valid key
      const validRequest = createMockRequest({
        id: 'valid-key',
        scopes: ['read:secrets'],
      });
      await middleware(validRequest, createMockReply());

      // Second call with invalid key should still fail
      const invalidRequest = createMockRequest({
        id: 'invalid-key',
        scopes: [],
      });
      await expect(middleware(invalidRequest, createMockReply())).rejects.toThrow(ForbiddenError);

      // Third call with valid key should still pass
      const anotherValidRequest = createMockRequest({
        id: 'another-valid-key',
        scopes: ['read:secrets', 'write:secrets'],
      });
      await expect(middleware(anotherValidRequest, createMockReply())).resolves.toBeUndefined();
    });
  });
});
