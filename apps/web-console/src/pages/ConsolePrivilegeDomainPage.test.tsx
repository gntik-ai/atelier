import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import ConsolePrivilegeDomainPage from './ConsolePrivilegeDomainPage';
import * as api from '../services/privilege-domain-api';

vi.mock('../services/privilege-domain-api');

const assignment = {
  memberId: 'member-1',
  workspaceId: 'ws-1',
  tenantId: 'tenant-1',
  structural_admin: true,
  data_access: true,
  assignedAt: '2026-03-31T00:00:00Z',
  updatedAt: '2026-03-31T00:00:00Z'
};

afterEach(() => {
  cleanup();
});

describe('ConsolePrivilegeDomainPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.getPrivilegeDomainAssignment).mockResolvedValue(assignment as any);
    vi.mocked(api.updatePrivilegeDomainAssignment).mockResolvedValue(assignment as any);
  });

  it('renders two separate sections', async () => {
    render(<ConsolePrivilegeDomainPage workspaceId="ws-1" memberId="member-1" />);
    expect(screen.getByTestId('loading-skeleton')).toBeTruthy();
    await screen.findByText('Structural Administration');
    expect(screen.getByText('Data Access')).toBeTruthy();
  });

  it('toggle calls update with correct payload', async () => {
    render(<ConsolePrivilegeDomainPage workspaceId="ws-1" memberId="member-1" />);
    await screen.findByText('Structural Administration');
    fireEvent.click(screen.getByText('Revoke Data Access'));
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(api.updatePrivilegeDomainAssignment).toHaveBeenCalledWith('ws-1', 'member-1', { structural_admin: true, data_access: false }));
  });

  it('shows confirmation dialog before revocation', async () => {
    render(<ConsolePrivilegeDomainPage workspaceId="ws-1" memberId="member-1" memberName="Alice" />);
    await screen.findByText('Structural Administration');
    fireEvent.click(screen.getByText('Revoke Structural Administration'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Alice/)).toBeTruthy();
  });

  it('last-admin guard shows error alert on API failure', async () => {
    vi.mocked(api.updatePrivilegeDomainAssignment).mockRejectedValue({ error: 'LAST_STRUCTURAL_ADMIN' });
    render(<ConsolePrivilegeDomainPage workspaceId="ws-1" memberId="member-1" />);
    await screen.findByText('Structural Administration');
    fireEvent.click(screen.getByText('Revoke Structural Administration'));
    fireEvent.click(screen.getByText('Confirm'));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('loading skeleton visible while request in flight', () => {
    vi.mocked(api.getPrivilegeDomainAssignment).mockReturnValue(new Promise(() => {}) as any);
    render(<ConsolePrivilegeDomainPage workspaceId="ws-1" memberId="member-1" />);
    expect(screen.getByTestId('loading-skeleton')).toBeTruthy();
  });
});
