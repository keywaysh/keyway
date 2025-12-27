import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingBanner } from '../app/components/dashboard/OnboardingBanner';

// Mock Next.js navigation with custom searchParams
const mockReplace = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  usePathname: () => '/orgs/test-org',
  useSearchParams: () => mockSearchParams,
}));

// Mock localStorage
const localStorageMock = {
  store: {} as Record<string, string>,
  getItem: vi.fn((key: string) => localStorageMock.store[key] || null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageMock.store[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageMock.store[key];
  }),
  clear: vi.fn(() => {
    localStorageMock.store = {};
  }),
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('OnboardingBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockSearchParams.delete('welcome');
  });

  describe('visibility', () => {
    it('should not render without welcome query param', () => {
      // No welcome param set
      render(<OnboardingBanner orgLogin="test-org" />);

      expect(screen.queryByText(/Welcome to test-org/)).not.toBeInTheDocument();
    });

    it('should render when welcome=true and not dismissed', async () => {
      mockSearchParams.set('welcome', 'true');

      render(<OnboardingBanner orgLogin="test-org" />);

      // Wait for useEffect to run
      await vi.waitFor(() => {
        expect(screen.getByText('Welcome to test-org on Keyway!')).toBeInTheDocument();
      });
    });

    it('should not render when dismissed via localStorage', async () => {
      mockSearchParams.set('welcome', 'true');
      localStorageMock.store['keyway_org_onboarding_test-org'] = 'true';

      render(<OnboardingBanner orgLogin="test-org" />);

      // Wait for useEffect to check localStorage
      await vi.waitFor(() => {
        expect(localStorageMock.getItem).toHaveBeenCalledWith('keyway_org_onboarding_test-org');
      });

      expect(screen.queryByText(/Welcome to test-org/)).not.toBeInTheDocument();
    });
  });

  describe('content', () => {
    beforeEach(() => {
      mockSearchParams.set('welcome', 'true');
    });

    it('should show organization name in title', async () => {
      render(<OnboardingBanner orgLogin="my-awesome-org" />);

      await vi.waitFor(() => {
        expect(screen.getByText('Welcome to my-awesome-org on Keyway!')).toBeInTheDocument();
      });
    });

    it('should show next steps message', async () => {
      render(<OnboardingBanner orgLogin="test-org" />);

      await vi.waitFor(() => {
        expect(screen.getByText(/Your organization is now connected/)).toBeInTheDocument();
      });
    });

    it('should show keyway init command', async () => {
      render(<OnboardingBanner orgLogin="test-org" />);

      await vi.waitFor(() => {
        expect(screen.getByText('keyway init')).toBeInTheDocument();
      });
    });

    it('should show invite team section', async () => {
      render(<OnboardingBanner orgLogin="test-org" />);

      await vi.waitFor(() => {
        expect(screen.getByText('Invite your team')).toBeInTheDocument();
        expect(screen.getByText(/Team members with repo access/)).toBeInTheDocument();
      });
    });
  });

  describe('dismiss functionality', () => {
    beforeEach(() => {
      mockSearchParams.set('welcome', 'true');
    });

    it('should dismiss banner when X clicked', async () => {
      render(<OnboardingBanner orgLogin="test-org" />);

      await vi.waitFor(() => {
        expect(screen.getByText('Welcome to test-org on Keyway!')).toBeInTheDocument();
      });

      const dismissButton = screen.getByRole('button', { name: /dismiss/i });
      fireEvent.click(dismissButton);

      expect(screen.queryByText('Welcome to test-org on Keyway!')).not.toBeInTheDocument();
    });

    it('should save dismissal to localStorage', async () => {
      render(<OnboardingBanner orgLogin="test-org" />);

      await vi.waitFor(() => {
        expect(screen.getByText('Welcome to test-org on Keyway!')).toBeInTheDocument();
      });

      const dismissButton = screen.getByRole('button', { name: /dismiss/i });
      fireEvent.click(dismissButton);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'keyway_org_onboarding_test-org',
        'true'
      );
    });

    it('should remove welcome query param on dismiss', async () => {
      render(<OnboardingBanner orgLogin="test-org" />);

      await vi.waitFor(() => {
        expect(screen.getByText('Welcome to test-org on Keyway!')).toBeInTheDocument();
      });

      const dismissButton = screen.getByRole('button', { name: /dismiss/i });
      fireEvent.click(dismissButton);

      expect(mockReplace).toHaveBeenCalledWith('/orgs/test-org', { scroll: false });
    });
  });

  describe('hydration safety', () => {
    it('should check localStorage on different org logins', async () => {
      mockSearchParams.set('welcome', 'true');

      const { rerender } = render(<OnboardingBanner orgLogin="org-a" />);

      await vi.waitFor(() => {
        expect(localStorageMock.getItem).toHaveBeenCalledWith('keyway_org_onboarding_org-a');
      });

      rerender(<OnboardingBanner orgLogin="org-b" />);

      await vi.waitFor(() => {
        expect(localStorageMock.getItem).toHaveBeenCalledWith('keyway_org_onboarding_org-b');
      });
    });
  });
});
