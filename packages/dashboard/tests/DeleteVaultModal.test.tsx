import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeleteVaultModal } from '../app/components/dashboard/DeleteVaultModal';
import type { Vault } from '../lib/types';

const mockVaultEmpty: Vault = {
  id: '1',
  repo_name: 'my-repo',
  repo_owner: 'my-org',
  repo_avatar: 'https://example.com/avatar.png',
  environments: ['default'],
  secrets_count: 0,
  permission: 'admin',
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
};

const mockVaultWithSecrets: Vault = {
  ...mockVaultEmpty,
  id: '2',
  secrets_count: 5,
};

describe('DeleteVaultModal', () => {
  const mockOnClose = vi.fn();
  const mockOnConfirm = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnConfirm.mockResolvedValue(undefined);
  });

  it('should not render when closed', () => {
    render(
      <DeleteVaultModal
        isOpen={false}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        vault={mockVaultEmpty}
      />
    );

    expect(screen.queryByText('Delete Vault')).not.toBeInTheDocument();
  });

  it('should not render when vault is null', () => {
    render(
      <DeleteVaultModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        vault={null}
      />
    );

    expect(screen.queryByText('Delete Vault')).not.toBeInTheDocument();
  });

  describe('empty vault', () => {
    it('should render simple confirmation for empty vault', () => {
      render(
        <DeleteVaultModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          vault={mockVaultEmpty}
        />
      );

      expect(screen.getByText('Delete Vault')).toBeInTheDocument();
      expect(screen.getByText(/This vault is empty/)).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('my-org/my-repo')).not.toBeInTheDocument();
    });

    it('should allow immediate deletion for empty vault', async () => {
      render(
        <DeleteVaultModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          vault={mockVaultEmpty}
        />
      );

      const deleteButton = screen.getByRole('button', { name: /delete vault/i });
      expect(deleteButton).not.toBeDisabled();

      fireEvent.click(deleteButton);

      await waitFor(() => {
        expect(mockOnConfirm).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('vault with secrets', () => {
    it('should require confirmation text for vault with secrets', () => {
      render(
        <DeleteVaultModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          vault={mockVaultWithSecrets}
        />
      );

      expect(screen.getByText(/This action cannot be undone/)).toBeInTheDocument();
      expect(screen.getByText(/5 secrets/)).toBeInTheDocument();
      expect(screen.getByPlaceholderText('my-org/my-repo')).toBeInTheDocument();
    });

    it('should disable delete button until correct text is entered', () => {
      render(
        <DeleteVaultModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          vault={mockVaultWithSecrets}
        />
      );

      const deleteButton = screen.getByRole('button', { name: /delete vault/i });
      expect(deleteButton).toBeDisabled();

      const input = screen.getByPlaceholderText('my-org/my-repo');
      fireEvent.change(input, { target: { value: 'wrong-text' } });
      expect(deleteButton).toBeDisabled();

      fireEvent.change(input, { target: { value: 'my-org/my-repo' } });
      expect(deleteButton).not.toBeDisabled();
    });

    it('should call onConfirm when correct text entered and delete clicked', async () => {
      render(
        <DeleteVaultModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          vault={mockVaultWithSecrets}
        />
      );

      const input = screen.getByPlaceholderText('my-org/my-repo');
      fireEvent.change(input, { target: { value: 'my-org/my-repo' } });

      const deleteButton = screen.getByRole('button', { name: /delete vault/i });
      fireEvent.click(deleteButton);

      await waitFor(() => {
        expect(mockOnConfirm).toHaveBeenCalledTimes(1);
      });
    });
  });

  it('should call onClose when cancel button clicked', () => {
    render(
      <DeleteVaultModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        vault={mockVaultEmpty}
      />
    );

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('should call onClose when backdrop clicked', () => {
    render(
      <DeleteVaultModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        vault={mockVaultEmpty}
      />
    );

    // Click the backdrop (the dark overlay)
    const backdrop = document.querySelector('.bg-black\\/60');
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    }
  });

  it('should show error message when deletion fails', async () => {
    mockOnConfirm.mockRejectedValue(new Error('Network error'));

    render(
      <DeleteVaultModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        vault={mockVaultEmpty}
      />
    );

    const deleteButton = screen.getByRole('button', { name: /delete vault/i });
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('should show "Deleting..." while deletion in progress', async () => {
    mockOnConfirm.mockImplementation(() => new Promise(() => {})); // Never resolves

    render(
      <DeleteVaultModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        vault={mockVaultEmpty}
      />
    );

    const deleteButton = screen.getByRole('button', { name: /delete vault/i });
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(screen.getByText('Deleting...')).toBeInTheDocument();
    });
  });

  it('should reset state when modal reopens', async () => {
    const { rerender } = render(
      <DeleteVaultModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        vault={mockVaultWithSecrets}
      />
    );

    // Enter some text
    const input = screen.getByPlaceholderText('my-org/my-repo');
    fireEvent.change(input, { target: { value: 'some-text' } });

    // Close and reopen
    rerender(
      <DeleteVaultModal
        isOpen={false}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        vault={mockVaultWithSecrets}
      />
    );

    rerender(
      <DeleteVaultModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        vault={mockVaultWithSecrets}
      />
    );

    // Input should be cleared
    const newInput = screen.getByPlaceholderText('my-org/my-repo');
    expect(newInput).toHaveValue('');
  });
});
