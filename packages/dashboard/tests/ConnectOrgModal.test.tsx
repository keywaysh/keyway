import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConnectOrgModal } from '../app/components/dashboard/ConnectOrgModal';

// Mock the API
vi.mock('../lib/api', () => ({
  api: {
    getAvailableOrganizations: vi.fn(),
  },
}));

// Mock analytics
vi.mock('../lib/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    ORG_CONNECT_MODAL_OPEN: 'org_connect_modal_open',
    ORG_APP_INSTALL_CLICK: 'org_app_install_click',
  },
}));

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ alt, ...props }: { alt: string; [key: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} {...props} />
  ),
}));

// Import mocked modules
import { api } from '../lib/api';
import { trackEvent, AnalyticsEvents } from '../lib/analytics';

describe('ConnectOrgModal', () => {
  const mockOnClose = vi.fn();
  const mockOnConnect = vi.fn();
  const mockGetAvailableOrganizations = api.getAvailableOrganizations as ReturnType<typeof vi.fn>;
  const installUrl = 'https://github.com/apps/keyway/installations/new';

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnConnect.mockResolvedValue(undefined);
    mockGetAvailableOrganizations.mockResolvedValue({
      organizations: [],
      install_url: installUrl,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('rendering', () => {
    it('should not render when closed', () => {
      render(
        <ConnectOrgModal
          isOpen={false}
          onClose={mockOnClose}
          onConnect={mockOnConnect}
        />
      );

      expect(screen.queryByText('Connect an Organization')).not.toBeInTheDocument();
    });

    it('should render modal title and description when open', async () => {
      render(
        <ConnectOrgModal
          isOpen={true}
          onClose={mockOnClose}
          onConnect={mockOnConnect}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Connect an Organization')).toBeInTheDocument();
      });
      expect(
        screen.getByText(/Connect a GitHub organization where the Keyway app is installed/)
      ).toBeInTheDocument();
    });

    it('should track modal open event', async () => {
      render(
        <ConnectOrgModal
          isOpen={true}
          onClose={mockOnClose}
          onConnect={mockOnConnect}
        />
      );

      await waitFor(() => {
        expect(trackEvent).toHaveBeenCalledWith(AnalyticsEvents.ORG_CONNECT_MODAL_OPEN);
      });
    });

    it('should show loading state while fetching install URL', async () => {
      mockGetAvailableOrganizations.mockImplementation(() => new Promise(() => {})); // Never resolves

      render(
        <ConnectOrgModal
          isOpen={true}
          onClose={mockOnClose}
          onConnect={mockOnConnect}
        />
      );

      // Should show loading spinner - check for the animate-spin class
      await waitFor(() => {
        const spinner = document.querySelector('.animate-spin');
        expect(spinner).toBeInTheDocument();
      });
    });

    it('should show error state when API fails', async () => {
      mockGetAvailableOrganizations.mockRejectedValue(new Error('Network error'));

      render(
        <ConnectOrgModal
          isOpen={true}
          onClose={mockOnClose}
          onConnect={mockOnConnect}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });
  });

  describe('connect flow', () => {
    const readyOrg = {
      login: 'acme',
      display_name: 'Acme Inc',
      avatar_url: 'https://avatar/acme.png',
      status: 'ready' as const,
      user_role: 'admin' as const,
      already_connected: false,
    };

    it('lists connectable orgs and connects on click', async () => {
      mockGetAvailableOrganizations.mockResolvedValue({
        organizations: [readyOrg],
        install_url: installUrl,
      });

      render(<ConnectOrgModal isOpen={true} onClose={mockOnClose} onConnect={mockOnConnect} />);

      await waitFor(() => {
        expect(screen.getByText('Acme Inc')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Connect/i }));

      await waitFor(() => {
        expect(mockOnConnect).toHaveBeenCalledWith('acme');
      });
      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it('does not list orgs that are already connected', async () => {
      mockGetAvailableOrganizations.mockResolvedValue({
        organizations: [{ ...readyOrg, already_connected: true }],
        install_url: installUrl,
      });

      render(<ConnectOrgModal isOpen={true} onClose={mockOnClose} onConnect={mockOnConnect} />);

      await waitFor(() => {
        expect(screen.getByText(/No organizations are ready to connect/i)).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /^Connect$/i })).not.toBeInTheDocument();
    });
  });

  describe('install button', () => {
    it('should show Install button when URL is loaded', async () => {
      render(
        <ConnectOrgModal
          isOpen={true}
          onClose={mockOnClose}
          onConnect={mockOnConnect}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('link', { name: /Install Keyway GitHub App/i })).toBeInTheDocument();
      });
    });

    it('should link to the install URL', async () => {
      render(
        <ConnectOrgModal
          isOpen={true}
          onClose={mockOnClose}
          onConnect={mockOnConnect}
        />
      );

      await waitFor(() => {
        const link = screen.getByRole('link', { name: /Install Keyway GitHub App/i });
        expect(link).toHaveAttribute('href', installUrl);
        expect(link).toHaveAttribute('target', '_blank');
      });
    });

    it('should track install click event', async () => {
      render(
        <ConnectOrgModal
          isOpen={true}
          onClose={mockOnClose}
          onConnect={mockOnConnect}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('link', { name: /Install Keyway GitHub App/i })).toBeInTheDocument();
      });

      const installLink = screen.getByRole('link', { name: /Install Keyway GitHub App/i });
      fireEvent.click(installLink);

      expect(trackEvent).toHaveBeenCalledWith(AnalyticsEvents.ORG_APP_INSTALL_CLICK);
    });

    it('shows no install link when loading fails', async () => {
      mockGetAvailableOrganizations.mockRejectedValue(new Error('Failed'));

      render(
        <ConnectOrgModal
          isOpen={true}
          onClose={mockOnClose}
          onConnect={mockOnConnect}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Failed')).toBeInTheDocument();
      });
      // installUrl never loaded → no install CTA rendered.
      expect(
        screen.queryByRole('link', { name: /Install Keyway GitHub App/i })
      ).not.toBeInTheDocument();
    });
  });

  describe('cleanup', () => {
    it('should refetch URL when modal reopens', async () => {
      const { rerender } = render(
        <ConnectOrgModal
          isOpen={true}
          onClose={mockOnClose}
          onConnect={mockOnConnect}
        />
      );

      await waitFor(() => {
        expect(mockGetAvailableOrganizations).toHaveBeenCalledTimes(1);
      });

      // Close modal
      rerender(
        <ConnectOrgModal
          isOpen={false}
          onClose={mockOnClose}
          onConnect={mockOnConnect}
        />
      );

      // Modal should not be visible
      expect(screen.queryByText('Connect an Organization')).not.toBeInTheDocument();

      // Reopen modal
      rerender(
        <ConnectOrgModal
          isOpen={true}
          onClose={mockOnClose}
          onConnect={mockOnConnect}
        />
      );

      // Should fetch install URL again
      await waitFor(() => {
        expect(mockGetAvailableOrganizations).toHaveBeenCalledTimes(2);
      });
    });
  });
});
