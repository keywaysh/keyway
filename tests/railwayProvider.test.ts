import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Railway Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAuthorizationUrl', () => {
    it('should throw error because Railway uses direct tokens, not OAuth', async () => {
      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      expect(() => railwayProvider.getAuthorizationUrl('test-state', 'http://localhost:3000/callback'))
        .toThrow(/Railway uses API token authentication/);
    });
  });

  describe('exchangeCodeForToken', () => {
    it('should throw error because Railway uses direct tokens, not OAuth', async () => {
      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      await expect(railwayProvider.exchangeCodeForToken('code', 'http://localhost:3000/callback'))
        .rejects.toThrow(/Railway uses API token authentication/);
    });
  });

  describe('getUser with Account Token', () => {
    it('should fetch user info from me query for Account Tokens', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            me: {
              id: 'user-123',
              email: 'test@railway.app',
              name: 'Test User',
              teams: {
                edges: [
                  { node: { id: 'team-456', name: 'My Team' } }
                ]
              }
            }
          }
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      const user = await railwayProvider.getUser('account-token');

      expect(user.id).toBe('user-123');
      expect(user.username).toBe('Test User');
      expect(user.email).toBe('test@railway.app');
      expect(user.teamId).toBe('team-456');
      expect(user.teamName).toBe('My Team');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://backboard.railway.com/graphql/v2',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer account-token',
          }),
        })
      );
    });

    it('should use email prefix as username when name is not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            me: {
              id: 'user-123',
              email: 'developer@company.com',
              name: null,
              teams: { edges: [] }
            }
          }
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      const user = await railwayProvider.getUser('account-token');

      expect(user.username).toBe('developer');
    });

    it('should handle user without teams', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            me: {
              id: 'user-123',
              email: 'solo@developer.com',
              name: 'Solo Dev',
              teams: { edges: [] }
            }
          }
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      const user = await railwayProvider.getUser('account-token');

      expect(user.id).toBe('user-123');
      expect(user.teamId).toBeUndefined();
      expect(user.teamName).toBeUndefined();
    });
  });

  describe('getUser with Team Token (fallback)', () => {
    it('should fallback to projects query when me query fails', async () => {
      // First call: me query fails (Team Token can't access me)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: null,
          errors: [{ message: 'Not Authorized' }]
        }),
      });
      // Second call: projects query succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            projects: {
              edges: [
                { node: { id: 'proj-1', name: 'Project 1' } },
                { node: { id: 'proj-2', name: 'Project 2' } },
              ]
            }
          }
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      const user = await railwayProvider.getUser('team-token');

      // Should return synthetic user based on token
      expect(user.id).toMatch(/^railway-team-/);
      expect(user.username).toContain('Railway Team');
      expect(user.username).toContain('2 projects');
      expect(user.email).toBeUndefined();
    });

    it('should throw original error when both me and projects queries fail', async () => {
      // First call: me query fails
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: null,
          errors: [{ message: 'Invalid token' }]
        }),
      });
      // Second call: projects query also fails
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: null,
          errors: [{ message: 'Unauthorized' }]
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      await expect(railwayProvider.getUser('invalid-token'))
        .rejects.toThrow('Invalid token');
    });
  });

  describe('listProjects', () => {
    it('should list projects with linked repos', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            projects: {
              edges: [
                {
                  node: {
                    id: 'proj-123',
                    name: 'my-app',
                    createdAt: '2024-01-01T00:00:00Z',
                    services: {
                      edges: [
                        {
                          node: {
                            id: 'svc-1',
                            name: 'web',
                            repoTriggers: {
                              edges: [
                                { node: { repository: 'owner/my-app' } }
                              ]
                            }
                          }
                        }
                      ]
                    }
                  }
                },
                {
                  node: {
                    id: 'proj-456',
                    name: 'standalone-service',
                    createdAt: '2024-02-01T00:00:00Z',
                    services: { edges: [] }
                  }
                }
              ]
            }
          }
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      const projects = await railwayProvider.listProjects('access-token');

      expect(projects).toHaveLength(2);
      expect(projects[0].id).toBe('proj-123');
      expect(projects[0].name).toBe('my-app');
      expect(projects[0].linkedRepo).toBe('owner/my-app');
      expect(projects[1].id).toBe('proj-456');
      expect(projects[1].linkedRepo).toBeUndefined();
    });

    it('should handle projects without services', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            projects: {
              edges: [
                {
                  node: {
                    id: 'proj-123',
                    name: 'empty-project',
                    createdAt: '2024-01-01T00:00:00Z',
                    services: null
                  }
                }
              ]
            }
          }
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      const projects = await railwayProvider.listProjects('access-token');

      expect(projects).toHaveLength(1);
      expect(projects[0].linkedRepo).toBeUndefined();
    });

    it('should handle empty projects list', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            projects: { edges: [] }
          }
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      const projects = await railwayProvider.listProjects('access-token');

      expect(projects).toHaveLength(0);
    });

    it('should extract linkedRepo from first service with repoTrigger', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            projects: {
              edges: [
                {
                  node: {
                    id: 'proj-123',
                    name: 'multi-service',
                    createdAt: '2024-01-01T00:00:00Z',
                    services: {
                      edges: [
                        {
                          node: {
                            id: 'svc-1',
                            name: 'frontend',
                            repoTriggers: { edges: [] }
                          }
                        },
                        {
                          node: {
                            id: 'svc-2',
                            name: 'backend',
                            repoTriggers: {
                              edges: [
                                { node: { repository: 'owner/backend-repo' } }
                              ]
                            }
                          }
                        }
                      ]
                    }
                  }
                }
              ]
            }
          }
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      const projects = await railwayProvider.listProjects('access-token');

      expect(projects[0].linkedRepo).toBe('owner/backend-repo');
    });
  });

  describe('listEnvVars', () => {
    const mockProjectWithEnvs = {
      data: {
        project: {
          id: 'proj-123',
          name: 'test-project',
          createdAt: '2024-01-01T00:00:00Z',
          environments: {
            edges: [
              { node: { id: 'env-id-production', name: 'production' } },
              { node: { id: 'env-id-staging', name: 'staging' } },
            ]
          },
          services: { edges: [] }
        }
      }
    };

    it('should list shared environment variables (no serviceId)', async () => {
      // First call: get project with environments
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjectWithEnvs),
      });
      // Second call: get variables
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            variables: [
              { key: 'DATABASE_URL', value: 'postgres://...' },
              { key: 'API_KEY', value: 'secret-key' },
            ]
          }
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      // Environment is passed as name (e.g., "production"), not ID
      const envVars = await railwayProvider.listEnvVars('access-token', 'proj-123', 'production');

      expect(envVars).toHaveLength(2);
      expect(envVars[0].key).toBe('DATABASE_URL');
      expect(envVars[1].key).toBe('API_KEY');
    });

    it('should list service variables when serviceId is provided via environment format', async () => {
      // First call: get project with environments
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjectWithEnvs),
      });
      // Second call: get service variables
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            variables: [
              { key: 'PORT', value: '3000' },
            ]
          }
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      // Environment format: "production:serviceId"
      const envVars = await railwayProvider.listEnvVars('access-token', 'proj-123', 'production:svc-789');

      expect(envVars).toHaveLength(1);
      expect(envVars[0].key).toBe('PORT');

      // Second call should include serviceId
      const callBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(callBody.variables.serviceId).toBe('svc-789');
    });

    it('should return empty array if environment not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjectWithEnvs),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      const envVars = await railwayProvider.listEnvVars('access-token', 'proj-123', 'nonexistent');

      expect(envVars).toHaveLength(0);
    });
  });

  describe('setEnvVars', () => {
    const mockProjectWithEnvs = {
      data: {
        project: {
          id: 'proj-123',
          name: 'test-project',
          createdAt: '2024-01-01T00:00:00Z',
          environments: {
            edges: [
              { node: { id: 'env-id-production', name: 'production' } },
            ]
          },
          services: { edges: [] }
        }
      }
    };

    it('should create new environment variables', async () => {
      // First call: get project with environments (for setEnvVars)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjectWithEnvs),
      });
      // Second call: get project with environments (for listEnvVars called inside setEnvVars)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjectWithEnvs),
      });
      // Third call: get existing variables (empty)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { variables: [] } }),
      });
      // Fourth + Fifth calls: upsert each variable
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: { variableUpsert: true } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: { variableUpsert: true } }),
        });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      const result = await railwayProvider.setEnvVars('access-token', 'proj-123', 'production', {
        NEW_VAR: 'value1',
        ANOTHER_VAR: 'value2',
      });

      expect(result.created).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(5); // 2 project queries + 1 listEnvVars + 2 upserts
    });

    it('should handle partial upsert failures gracefully', async () => {
      // First call: get project with environments (for setEnvVars)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjectWithEnvs),
      });
      // Second call: get project with environments (for listEnvVars)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjectWithEnvs),
      });
      // Third call: get existing variables (empty)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { variables: [] } }),
      });
      // First variable succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { variableUpsert: true } }),
      });
      // Second variable fails
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: null,
          errors: [{ message: 'Variable name is reserved' }]
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      // When some operations succeed and some fail, it returns stats (doesn't throw)
      const result = await railwayProvider.setEnvVars('access-token', 'proj-123', 'production', {
        VALID_VAR: 'value1',
        RAILWAY_RESERVED: 'value2',
      });

      expect(result.created).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.failedKeys).toContain('RAILWAY_RESERVED');
    });

    it('should throw when all upsert operations fail', async () => {
      // First call: get project with environments (for setEnvVars)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjectWithEnvs),
      });
      // Second call: get project with environments (for listEnvVars)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjectWithEnvs),
      });
      // Third call: get existing variables (empty)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { variables: [] } }),
      });
      // All variables fail
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: null,
          errors: [{ message: 'Variable name is reserved' }]
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      // When ALL operations fail, it throws
      await expect(railwayProvider.setEnvVars('access-token', 'proj-123', 'production', {
        RAILWAY_RESERVED: 'value',
      })).rejects.toThrow('Failed to set all 1 environment variables');
    });
  });

  describe('deleteEnvVar', () => {
    const mockProjectWithEnvs = {
      data: {
        project: {
          id: 'proj-123',
          name: 'test-project',
          createdAt: '2024-01-01T00:00:00Z',
          environments: {
            edges: [
              { node: { id: 'env-id-production', name: 'production' } },
            ]
          },
          services: { edges: [] }
        }
      }
    };

    it('should delete environment variable', async () => {
      // First call: get project with environments
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjectWithEnvs),
      });
      // Second call: delete variable
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { variableDelete: true } }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      await railwayProvider.deleteEnvVar('access-token', 'proj-123', 'production', 'OLD_VAR');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const deleteCallBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(deleteCallBody.variables.input.name).toBe('OLD_VAR');
    });

    it('should handle delete of non-existent environment gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjectWithEnvs),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      // Should not throw, just silently succeed (environment not found = nothing to delete)
      await railwayProvider.deleteEnvVar('access-token', 'proj-123', 'nonexistent', 'OLD_VAR');
    });
  });

  describe('error handling', () => {
    it('should handle rate limiting (429)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: {
          get: (name: string) => name === 'Retry-After' ? '60' : null,
        },
        json: () => Promise.resolve({}),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      await expect(railwayProvider.listProjects('access-token'))
        .rejects.toThrow(/rate limited/i);
    });

    it('should handle network errors', async () => {
      const networkError = new TypeError('fetch failed');
      networkError.message = 'fetch';
      mockFetch.mockRejectedValueOnce(networkError);

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      await expect(railwayProvider.listProjects('access-token'))
        .rejects.toThrow(/network error/i);
    });

    it('should handle timeout', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      await expect(railwayProvider.listProjects('access-token'))
        .rejects.toThrow(/timed out/i);
    });

    it('should handle GraphQL errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: null,
          errors: [{ message: 'Project not found', extensions: { code: 'NOT_FOUND' } }]
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      await expect(railwayProvider.listProjects('access-token'))
        .rejects.toThrow('Project not found');
    });

    it('should handle empty GraphQL response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: null,
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      await expect(railwayProvider.listProjects('access-token'))
        .rejects.toThrow(/empty response/i);
    });

    it('should handle malformed JSON response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      await expect(railwayProvider.listProjects('access-token'))
        .rejects.toThrow(/invalid response/i);
    });
  });

  describe('token type detection', () => {
    it('should work with Account Token (me query succeeds)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            me: {
              id: 'user-123',
              email: 'user@example.com',
              name: 'Account User',
              teams: { edges: [] }
            }
          }
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      const user = await railwayProvider.getUser('account-token-xxx');

      expect(user.id).toBe('user-123');
      expect(user.email).toBe('user@example.com');
    });

    it('should work with Team Token (me query fails, projects succeeds)', async () => {
      // me query fails
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: null,
          errors: [{ message: 'Not Authorized' }]
        }),
      });
      // projects query succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            projects: {
              edges: [
                { node: { id: 'proj-1', name: 'Team Project' } }
              ]
            }
          }
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      const user = await railwayProvider.getUser('team-token-xxx');

      expect(user.id).toMatch(/^railway-team-team-tok/);
      expect(user.username).toContain('Railway Team');
      expect(user.email).toBeUndefined();
    });

    it('should reject invalid tokens (both queries fail)', async () => {
      // me query fails
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: null,
          errors: [{ message: 'Invalid token format' }]
        }),
      });
      // projects query also fails
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: null,
          errors: [{ message: 'Unauthorized' }]
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      await expect(railwayProvider.getUser('invalid-garbage'))
        .rejects.toThrow('Invalid token format');
    });
  });
});
