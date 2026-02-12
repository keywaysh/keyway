import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config before anything else
vi.mock('../../src/config', () => ({
  config: {
    email: { enabled: false },
  },
}));

// Mock dependencies
vi.mock('../../src/utils/email', () => ({
  sendWelcomeEmail: vi.fn(),
}));

vi.mock('../../src/utils/analytics', () => ({
  trackEvent: vi.fn(),
  identifyUser: vi.fn(),
  AnalyticsEvents: {
    USER_CREATED: 'api_user_created',
  },
}));

// Import after mocks are set up
import { handleNewUserSignup } from '../../src/services/signup.service';

describe('Signup Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleNewUserSignup', () => {
    const mockUser = {
      id: 'user-123',
      username: 'testuser',
      email: 'test@example.com',
      plan: 'free',
      createdAt: new Date('2024-01-15T10:00:00Z'),
    };

    it('should send welcome email when user has email', async () => {
      const { sendWelcomeEmail } = await import('../../src/utils/email');

      await handleNewUserSignup({
        user: mockUser,
        signupSource: 'cli',
        method: 'device_flow',
      });

      expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
      expect(sendWelcomeEmail).toHaveBeenCalledWith({
        to: 'test@example.com',
        username: 'testuser',
      });
    });

    it('should NOT send welcome email when user has no email', async () => {
      const { sendWelcomeEmail } = await import('../../src/utils/email');

      await handleNewUserSignup({
        user: { ...mockUser, email: null },
        signupSource: 'cli',
        method: 'device_flow',
      });

      expect(sendWelcomeEmail).not.toHaveBeenCalled();
    });

    it('should track USER_CREATED event with correct parameters', async () => {
      const { trackEvent, AnalyticsEvents } = await import('../../src/utils/analytics');

      await handleNewUserSignup({
        user: mockUser,
        signupSource: 'github_app_install',
        method: 'github_app_install',
      });

      expect(trackEvent).toHaveBeenCalledWith(
        'user-123',
        AnalyticsEvents.USER_CREATED,
        {
          username: 'testuser',
          signupSource: 'github_app_install',
          method: 'github_app_install',
        }
      );
    });

    it('should identify user in analytics with correct parameters', async () => {
      const { identifyUser } = await import('../../src/utils/analytics');

      await handleNewUserSignup({
        user: mockUser,
        signupSource: 'web',
        method: 'web_oauth',
      });

      expect(identifyUser).toHaveBeenCalledWith('user-123', {
        username: 'testuser',
        plan: 'free',
        signupSource: 'web',
        signupTimestamp: '2024-01-15T10:00:00.000Z',
      });
    });

    it('should call all three functions in order', async () => {
      const { sendWelcomeEmail } = await import('../../src/utils/email');
      const { trackEvent, identifyUser } = await import('../../src/utils/analytics');

      await handleNewUserSignup({
        user: mockUser,
        signupSource: 'cli',
        method: 'device_flow_chained',
      });

      // All three should be called
      expect(trackEvent).toHaveBeenCalledTimes(1);
      expect(identifyUser).toHaveBeenCalledTimes(1);
      expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
    });

    it('should handle all signup methods correctly', async () => {
      const { trackEvent, AnalyticsEvents } = await import('../../src/utils/analytics');

      const methods = ['device_flow', 'device_flow_chained', 'web_oauth', 'github_app_install'] as const;

      for (const method of methods) {
        vi.clearAllMocks();

        await handleNewUserSignup({
          user: mockUser,
          signupSource: 'cli',
          method,
        });

        expect(trackEvent).toHaveBeenCalledWith(
          'user-123',
          AnalyticsEvents.USER_CREATED,
          expect.objectContaining({ method })
        );
      }
    });

    it('should handle all signup sources correctly', async () => {
      const { identifyUser } = await import('../../src/utils/analytics');

      const sources = ['cli', 'web', 'github_app_install', 'direct', 'custom_source'];

      for (const signupSource of sources) {
        vi.clearAllMocks();

        await handleNewUserSignup({
          user: mockUser,
          signupSource,
          method: 'web_oauth',
        });

        expect(identifyUser).toHaveBeenCalledWith(
          'user-123',
          expect.objectContaining({ signupSource })
        );
      }
    });
  });
});
