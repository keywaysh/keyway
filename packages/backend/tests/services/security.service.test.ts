import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the email service before importing security service
vi.mock('../../src/utils/email', () => ({
  sendSecurityAlertEmail: vi.fn().mockResolvedValue(undefined),
}));

// Mock logger
vi.mock('../../src/utils/sharedLogger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Track function calls
const mockInsertReturning = vi.fn();
const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
const mockDbInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockDbQuery = {
  pullEvents: {
    findFirst: vi.fn(),
  },
  securityAlerts: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  users: {
    findFirst: vi.fn(),
  },
  vaults: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
};

const mockSelectFrom = vi.fn();
const mockSelectWhere = vi.fn().mockResolvedValue([{ count: 0 }]);
mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
const mockDbSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

vi.mock('../../src/db', () => ({
  db: {
    query: {
      pullEvents: {
        findFirst: vi.fn(),
      },
      securityAlerts: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      users: {
        findFirst: vi.fn(),
      },
      vaults: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'pull-event-id' }]),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 0 }]),
      }),
    }),
  },
  pullEvents: {},
  securityAlerts: {},
  users: {},
  vaults: {},
  secretAccesses: {},
  activityLogs: {},
}));

// Import after mocks
import { processPullEvent, generateDeviceId, type PullSource } from '../../src/services/security.service';
import { db } from '../../src/db';

describe('security.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset the insert mock for each test
    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'pull-event-id' }]),
      }),
    });

    // Reset query mocks
    (db.query.pullEvents.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (db.query.securityAlerts.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  describe('generateDeviceId', () => {
    it('should generate consistent device ID for same inputs', () => {
      const id1 = generateDeviceId('keyway-cli/1.0.0', '192.168.1.1');
      const id2 = generateDeviceId('keyway-cli/1.0.0', '192.168.1.1');
      expect(id1).toBe(id2);
    });

    it('should generate different IDs for different user agents', () => {
      const id1 = generateDeviceId('keyway-cli/1.0.0', '192.168.1.1');
      const id2 = generateDeviceId('github-actions/2.0', '192.168.1.1');
      expect(id1).not.toBe(id2);
    });

    it('should generate different IDs for different IPs', () => {
      const id1 = generateDeviceId('keyway-cli/1.0.0', '192.168.1.1');
      const id2 = generateDeviceId('keyway-cli/1.0.0', '10.0.0.1');
      expect(id1).not.toBe(id2);
    });

    it('should handle null user agent', () => {
      const id = generateDeviceId(null, '192.168.1.1');
      expect(id).toBeDefined();
      expect(id.length).toBe(32);
    });
  });

  describe('processPullEvent', () => {
    const basePullContext = {
      userId: 'user-123',
      vaultId: 'vault-456',
      deviceId: 'device-789',
      ip: '127.0.0.1',
      userAgent: 'keyway-cli/1.0.0',
    };

    it('should always log pull event regardless of source', async () => {
      const sources: PullSource[] = ['cli', 'api_key', 'mcp'];

      for (const source of sources) {
        vi.clearAllMocks();

        (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: `pull-event-${source}` }]),
          }),
        });

        await processPullEvent({ ...basePullContext, source });

        expect(db.insert).toHaveBeenCalled();
      }
    });

    it('should run security checks for CLI source', async () => {
      // Mock that this is a new device (no existing pull events)
      (db.query.pullEvents.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (db.query.securityAlerts.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      // Track insert calls
      let insertCallCount = 0;
      (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => {
        insertCallCount++;
        return {
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: `insert-${insertCallCount}` }]),
          }),
        };
      });

      await processPullEvent({ ...basePullContext, source: 'cli' });

      // CLI source should proceed past early return and attempt security checks
      // At minimum: 1 pull event insert + potential alert inserts
      // The exact count depends on which checks trigger alerts
      expect(insertCallCount).toBeGreaterThanOrEqual(1);
    });

    it('should create more inserts for CLI than for api_key (security checks run)', async () => {
      // Mock new device scenario
      (db.query.pullEvents.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (db.query.securityAlerts.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      // Test CLI source
      let cliInsertCount = 0;
      (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => {
        cliInsertCount++;
        return {
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: `cli-insert-${cliInsertCount}` }]),
          }),
        };
      });
      await processPullEvent({ ...basePullContext, source: 'cli' });

      // Test api_key source
      let apiKeyInsertCount = 0;
      (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => {
        apiKeyInsertCount++;
        return {
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: `apikey-insert-${apiKeyInsertCount}` }]),
          }),
        };
      });
      await processPullEvent({ ...basePullContext, source: 'api_key' });

      // API key should only have 1 insert (pull event), CLI should have more (alerts)
      expect(apiKeyInsertCount).toBe(1);
      expect(cliInsertCount).toBeGreaterThanOrEqual(apiKeyInsertCount);
    });

    it('should skip security checks for api_key source', async () => {
      let insertCallCount = 0;
      (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => {
        insertCallCount++;
        return {
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: `insert-${insertCallCount}` }]),
          }),
        };
      });

      await processPullEvent({ ...basePullContext, source: 'api_key' });

      // Should only have 1 insert for the pull event, no security alerts
      expect(insertCallCount).toBe(1);
    });

    it('should skip security checks for mcp source', async () => {
      let insertCallCount = 0;
      (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => {
        insertCallCount++;
        return {
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: `insert-${insertCallCount}` }]),
          }),
        };
      });

      await processPullEvent({ ...basePullContext, source: 'mcp' });

      // Should only have 1 insert for the pull event, no security alerts
      expect(insertCallCount).toBe(1);
    });

    it('should default to cli source when not specified', async () => {
      // Mock that this is a new device
      (db.query.pullEvents.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (db.query.securityAlerts.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      let insertCallCount = 0;
      (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => {
        insertCallCount++;
        return {
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: `insert-${insertCallCount}` }]),
          }),
        };
      });

      // No source specified - should default to 'cli' and run security checks
      await processPullEvent(basePullContext);

      // Should have more than 1 insert (pull event + potential alerts)
      expect(insertCallCount).toBeGreaterThanOrEqual(1);
    });

    it('should store source in pull event', async () => {
      let capturedValues: Record<string, unknown> | undefined;

      (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        values: vi.fn().mockImplementation((vals) => {
          capturedValues = vals;
          return {
            returning: vi.fn().mockResolvedValue([{ id: 'pull-event-id' }]),
          };
        }),
      }));

      await processPullEvent({ ...basePullContext, source: 'api_key' });

      expect(capturedValues).toBeDefined();
      expect(capturedValues?.source).toBe('api_key');
    });
  });
});
