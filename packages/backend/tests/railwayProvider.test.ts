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

    it('should extract serviceName from service with linked repo', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            projects: {
              edges: [
                {
                  node: {
                    id: 'proj-123',
                    name: 'affectionate-success', // Random project name
                    createdAt: '2024-01-01T00:00:00Z',
                    environments: { edges: [] },
                    services: {
                      edges: [
                        {
                          node: {
                            id: 'svc-1',
                            name: 'keyway-backend', // Meaningful service name
                            repoTriggers: {
                              edges: [
                                { node: { repository: 'owner/keyway' } }
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

      expect(projects[0].name).toBe('affectionate-success');
      expect(projects[0].serviceName).toBe('keyway-backend');
      expect(projects[0].linkedRepo).toBe('owner/keyway');
    });

    it('should extract environments from project', async () => {
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
                    environments: {
                      edges: [
                        { node: { id: 'env-1', name: 'production' } },
                        { node: { id: 'env-2', name: 'staging' } },
                      ]
                    },
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

      expect(projects[0].environments).toEqual(['production', 'staging']);
    });

    it('should return empty environments when project has none', async () => {
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
                    environments: { edges: [] },
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

      expect(projects[0].environments).toEqual([]);
    });

    it('should use first service name as fallback when no repo linked', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            projects: {
              edges: [
                {
                  node: {
                    id: 'proj-123',
                    name: 'random-name',
                    createdAt: '2024-01-01T00:00:00Z',
                    environments: { edges: [] },
                    services: {
                      edges: [
                        {
                          node: {
                            id: 'svc-1',
                            name: 'my-service',
                            repoTriggers: { edges: [] } // No repo linked
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

      expect(projects[0].serviceName).toBe('my-service');
      expect(projects[0].linkedRepo).toBeUndefined();
    });

    it('should return one entry per service when project has multiple services with different repos', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            projects: {
              edges: [
                {
                  node: {
                    id: 'proj-keyway',
                    name: 'Keyway', // Single project name
                    createdAt: '2024-01-01T00:00:00Z',
                    environments: {
                      edges: [
                        { node: { id: 'env-dev', name: 'dev' } },
                        { node: { id: 'env-prod', name: 'production' } },
                      ]
                    },
                    services: {
                      edges: [
                        {
                          node: {
                            id: 'svc-backend',
                            name: 'keyway-backend',
                            repoTriggers: {
                              edges: [
                                { node: { repository: 'keywaysh/keyway-backend' } }
                              ]
                            }
                          }
                        },
                        {
                          node: {
                            id: 'svc-crypto',
                            name: 'keyway-crypto',
                            repoTriggers: {
                              edges: [
                                { node: { repository: 'keywaysh/keyway-crypto' } }
                              ]
                            }
                          }
                        },
                        {
                          node: {
                            id: 'svc-postgres',
                            name: 'Postgres',
                            repoTriggers: { edges: [] } // No linked repo
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

      // Should return 2 entries (only services with linked repos)
      expect(projects).toHaveLength(2);

      // First entry: keyway-backend
      expect(projects[0].id).toBe('proj-keyway');
      expect(projects[0].name).toBe('Keyway');
      expect(projects[0].serviceId).toBe('svc-backend');
      expect(projects[0].serviceName).toBe('keyway-backend');
      expect(projects[0].linkedRepo).toBe('keywaysh/keyway-backend');
      expect(projects[0].environments).toEqual(['dev', 'production']);

      // Second entry: keyway-crypto
      expect(projects[1].id).toBe('proj-keyway');
      expect(projects[1].name).toBe('Keyway');
      expect(projects[1].serviceId).toBe('svc-crypto');
      expect(projects[1].serviceName).toBe('keyway-crypto');
      expect(projects[1].linkedRepo).toBe('keywaysh/keyway-crypto');
      expect(projects[1].environments).toEqual(['dev', 'production']);
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
      // Second call: get variables (Railway returns key/value object)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            variables: {
              'DATABASE_URL': 'postgres://...',
              'API_KEY': 'secret-key',
            }
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
      // Second call: get service variables (Railway returns key/value object)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            variables: {
              'PORT': '3000',
            }
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

    it('should filter out system variables (RAILWAY_*, NIXPACKS_*)', async () => {
      // First call: get project with environments
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjectWithEnvs),
      });
      // Second call: get variables including system vars
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            variables: {
              'DATABASE_URL': 'postgres://...',
              'API_KEY': 'secret-key',
              'RAILWAY_ENVIRONMENT': 'production',
              'RAILWAY_SERVICE_ID': 'svc-123',
              'RAILWAY_PROJECT_ID': 'proj-123',
              'NIXPACKS_MIRROR': 'https://...',
            }
          }
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      const envVars = await railwayProvider.listEnvVars('access-token', 'proj-123', 'production');

      // Should only return user variables, not system variables
      expect(envVars).toHaveLength(2);
      expect(envVars.map(v => v.key)).toEqual(['DATABASE_URL', 'API_KEY']);
      expect(envVars.map(v => v.key)).not.toContain('RAILWAY_ENVIRONMENT');
      expect(envVars.map(v => v.key)).not.toContain('NIXPACKS_MIRROR');
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

    it('should create new environment variables using bulk mutation', async () => {
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
        json: () => Promise.resolve({ data: { variables: {} } }),
      });
      // Fourth call: bulk upsert all variables in one call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { variableCollectionUpsert: true } }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      const result = await railwayProvider.setEnvVars('access-token', 'proj-123', 'production', {
        NEW_VAR: 'value1',
        ANOTHER_VAR: 'value2',
      });

      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.failed).toBe(0);
      // Should use bulk mutation: 1 project query + 1 project query for listEnvVars + 1 get vars + 1 bulk upsert
      expect(mockFetch).toHaveBeenCalledTimes(4);

      // Verify the bulk mutation was called with skipDeploys: true
      const bulkCallBody = JSON.parse(mockFetch.mock.calls[3][1].body);
      expect(bulkCallBody.query).toContain('variableCollectionUpsert');
      expect(bulkCallBody.variables.input.skipDeploys).toBe(true);
      expect(bulkCallBody.variables.input.variables).toEqual({
        NEW_VAR: 'value1',
        ANOTHER_VAR: 'value2',
      });
    });

    it('should throw when bulk upsert fails', async () => {
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
        json: () => Promise.resolve({ data: { variables: {} } }),
      });
      // Fourth call: bulk upsert fails
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: null,
          errors: [{ message: 'Variable name is reserved' }]
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      // When bulk operation fails, it throws with all keys as failed
      await expect(railwayProvider.setEnvVars('access-token', 'proj-123', 'production', {
        VALID_VAR: 'value1',
        RAILWAY_RESERVED: 'value2',
      })).rejects.toThrow('Failed to set 2 environment variables');
    });

    it('should correctly count created vs updated variables', async () => {
      // First call: get project with environments
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjectWithEnvs),
      });
      // Second call: get project for listEnvVars
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProjectWithEnvs),
      });
      // Third call: get existing variables (one already exists)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { variables: { EXISTING_VAR: 'old-value' } } }),
      });
      // Fourth call: bulk upsert succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { variableCollectionUpsert: true } }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      const result = await railwayProvider.setEnvVars('access-token', 'proj-123', 'production', {
        EXISTING_VAR: 'new-value', // This is an update
        NEW_VAR: 'value1',         // This is a create
      });

      expect(result.created).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('should trigger redeploy after bulk update when serviceId is provided', async () => {
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
        json: () => Promise.resolve({ data: { variables: {} } }),
      });
      // Fourth call: bulk upsert succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { variableCollectionUpsert: true } }),
      });
      // Fifth call: get latest deployment
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            deployments: {
              edges: [{ node: { id: 'deploy-123', status: 'SUCCESS' } }]
            }
          }
        }),
      });
      // Sixth call: trigger redeploy
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { deploymentRedeploy: true } }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      // Use environment format with serviceId: "production:service-id"
      const result = await railwayProvider.setEnvVars('access-token', 'proj-123', 'production:svc-123', {
        NEW_VAR: 'value1',
      });

      expect(result.created).toBe(1);
      expect(result.failed).toBe(0);
      // Should call: 2 project queries + 1 get vars + 1 bulk upsert + 1 get deployments + 1 redeploy
      expect(mockFetch).toHaveBeenCalledTimes(6);

      // Verify redeploy was called with correct deployment ID
      const redeployCallBody = JSON.parse(mockFetch.mock.calls[5][1].body);
      expect(redeployCallBody.query).toContain('deploymentRedeploy');
      expect(redeployCallBody.variables.id).toBe('deploy-123');
    });

    it('should succeed even if redeploy fails (variables were already updated)', async () => {
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
        json: () => Promise.resolve({ data: { variables: {} } }),
      });
      // Fourth call: bulk upsert succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { variableCollectionUpsert: true } }),
      });
      // Fifth call: get latest deployment fails
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: null,
          errors: [{ message: 'Deployment not found' }]
        }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      // Should NOT throw - variables were updated successfully
      const result = await railwayProvider.setEnvVars('access-token', 'proj-123', 'production:svc-123', {
        NEW_VAR: 'value1',
      });

      expect(result.created).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('should not trigger redeploy for shared variables (no serviceId)', async () => {
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
        json: () => Promise.resolve({ data: { variables: {} } }),
      });
      // Fourth call: bulk upsert succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { variableCollectionUpsert: true } }),
      });

      const { railwayProvider } = await import('../src/services/providers/railway.provider');

      // No serviceId means shared variables - no redeploy triggered
      const result = await railwayProvider.setEnvVars('access-token', 'proj-123', 'production', {
        SHARED_VAR: 'value1',
      });

      expect(result.created).toBe(1);
      expect(result.failed).toBe(0);
      // Should only be 4 calls (no redeploy)
      expect(mockFetch).toHaveBeenCalledTimes(4);
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
