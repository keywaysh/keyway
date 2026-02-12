import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CollaboratorRow, CollaboratorRowSkeleton, PermissionBadge } from '../app/components/dashboard/CollaboratorRow';
import type { Collaborator, VaultPermission } from '../lib/types';

const mockCollaborator: Collaborator = {
  login: 'johndoe',
  avatarUrl: 'https://avatars.githubusercontent.com/johndoe',
  htmlUrl: 'https://github.com/johndoe',
  permission: 'write',
};

describe('CollaboratorRow', () => {
  it('should render collaborator login', () => {
    render(<CollaboratorRow collaborator={mockCollaborator} />);
    expect(screen.getByText('johndoe')).toBeInTheDocument();
  });

  it('should render avatar container', () => {
    const { container } = render(<CollaboratorRow collaborator={mockCollaborator} />);
    // Avatar component renders a span with relative class as the container
    const avatarContainer = container.querySelector('.rounded-full.h-10.w-10');
    expect(avatarContainer).toBeInTheDocument();
  });

  it('should render fallback initials when avatar fails to load', () => {
    render(<CollaboratorRow collaborator={mockCollaborator} />);
    expect(screen.getByText('JO')).toBeInTheDocument();
  });

  it('should render GitHub link with correct URL', () => {
    render(<CollaboratorRow collaborator={mockCollaborator} />);
    const link = screen.getByRole('link', { name: /github/i });
    expect(link).toHaveAttribute('href', 'https://github.com/johndoe');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  describe('permission labels', () => {
    const permissions: VaultPermission[] = ['admin', 'maintain', 'write', 'triage', 'read'];
    const expectedLabels: Record<VaultPermission, string> = {
      admin: 'Admin',
      maintain: 'Maintain',
      write: 'Write',
      triage: 'Triage',
      read: 'Read',
    };

    permissions.forEach((permission) => {
      it(`should display "${expectedLabels[permission]}" for ${permission} permission`, () => {
        const collaborator: Collaborator = { ...mockCollaborator, permission };
        render(<CollaboratorRow collaborator={collaborator} />);
        expect(screen.getByText(expectedLabels[permission])).toBeInTheDocument();
      });
    });
  });

  describe('permission colors', () => {
    it('should apply amber color for admin permission', () => {
      const collaborator: Collaborator = { ...mockCollaborator, permission: 'admin' };
      render(<CollaboratorRow collaborator={collaborator} />);
      const label = screen.getByText('Admin');
      expect(label.className).toContain('text-amber-400');
    });

    it('should apply purple color for maintain permission', () => {
      const collaborator: Collaborator = { ...mockCollaborator, permission: 'maintain' };
      render(<CollaboratorRow collaborator={collaborator} />);
      const label = screen.getByText('Maintain');
      expect(label.className).toContain('text-purple-400');
    });

    it('should apply emerald color for write permission', () => {
      const collaborator: Collaborator = { ...mockCollaborator, permission: 'write' };
      render(<CollaboratorRow collaborator={collaborator} />);
      const label = screen.getByText('Write');
      expect(label.className).toContain('text-emerald-400');
    });

    it('should apply blue color for triage permission', () => {
      const collaborator: Collaborator = { ...mockCollaborator, permission: 'triage' };
      render(<CollaboratorRow collaborator={collaborator} />);
      const label = screen.getByText('Triage');
      expect(label.className).toContain('text-blue-400');
    });

    it('should apply muted color for read permission', () => {
      const collaborator: Collaborator = { ...mockCollaborator, permission: 'read' };
      render(<CollaboratorRow collaborator={collaborator} />);
      const label = screen.getByText('Read');
      expect(label.className).toContain('text-muted-foreground');
    });
  });
});

describe('CollaboratorRowSkeleton', () => {
  it('should render skeleton elements', () => {
    const { container } = render(<CollaboratorRowSkeleton />);

    // Should have skeleton elements
    const skeletons = container.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should render avatar skeleton with rounded-full class', () => {
    const { container } = render(<CollaboratorRowSkeleton />);
    const avatarSkeleton = container.querySelector('.rounded-full');
    expect(avatarSkeleton).toBeInTheDocument();
  });
});

describe('PermissionBadge', () => {
  const permissions: VaultPermission[] = ['admin', 'maintain', 'write', 'triage', 'read'];
  const expectedLabels: Record<VaultPermission, string> = {
    admin: 'Admin',
    maintain: 'Maintain',
    write: 'Write',
    triage: 'Triage',
    read: 'Read',
  };

  permissions.forEach((permission) => {
    it(`should render ${permission} badge with correct label`, () => {
      render(<PermissionBadge permission={permission} />);
      expect(screen.getByText(expectedLabels[permission])).toBeInTheDocument();
    });
  });

  it('should have rounded-full class for pill shape', () => {
    const { container } = render(<PermissionBadge permission="admin" />);
    const badge = container.querySelector('.rounded-full');
    expect(badge).toBeInTheDocument();
  });

  it('should apply correct background and text colors for admin', () => {
    const { container } = render(<PermissionBadge permission="admin" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-amber-400/10');
    expect(badge.className).toContain('text-amber-400');
  });

  it('should apply correct background and text colors for write', () => {
    const { container } = render(<PermissionBadge permission="write" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-emerald-400/10');
    expect(badge.className).toContain('text-emerald-400');
  });
});
