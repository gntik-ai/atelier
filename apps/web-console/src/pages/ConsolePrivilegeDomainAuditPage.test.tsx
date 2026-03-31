import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConsolePrivilegeDomainAuditPage from './ConsolePrivilegeDomainAuditPage';
import * as api from '../services/privilege-domain-api';

vi.mock('../services/privilege-domain-api');

const response = {
  denials: [{
    id: 'd1', tenantId: 'tenant-1', workspaceId: 'ws-1', actorId: 'actor-1', actorType: 'user', credentialDomain: 'data_access', requiredDomain: 'structural_admin', httpMethod: 'POST', requestPath: '/v1/schemas', sourceIp: '1.2.3.4', correlationId: 'corr-1', deniedAt: new Date().toISOString()
  }],
  total: 1,
  limit: 50,
  offset: 0
};

describe('ConsolePrivilegeDomainAuditPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.queryPrivilegeDomainDenials).mockResolvedValue(response as any);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders filter bar and empty table on initial load', async () => {
    render(<ConsolePrivilegeDomainAuditPage />);
    expect(screen.getByLabelText('requiredDomain')).toBeTruthy();
    await screen.findByText('/v1/schemas');
  });

  it('selecting requiredDomain triggers api call', async () => {
    render(<ConsolePrivilegeDomainAuditPage />);
    fireEvent.change(screen.getByLabelText('requiredDomain'), { target: { value: 'structural_admin' } });
    await waitFor(() => expect(api.queryPrivilegeDomainDenials).toHaveBeenLastCalledWith(expect.objectContaining({ requiredDomain: 'structural_admin' })));
  });

  it('results displayed in table', async () => {
    render(<ConsolePrivilegeDomainAuditPage />);
    expect(await screen.findByText('/v1/schemas')).toBeTruthy();
  });

  it('24h denial badge shows correct count', async () => {
    render(<ConsolePrivilegeDomainAuditPage />);
    await screen.findByText('/v1/schemas');
    expect(screen.getByTestId('denial-badge').textContent).toBe('1');
  });

  it('export button generates csv', async () => {
    render(<ConsolePrivilegeDomainAuditPage />);
    const link = await screen.findByText('Export CSV');
    expect(link.getAttribute('href')).toContain('data:text/csv');
  });

  it('pagination next page increments offset', async () => {
    vi.mocked(api.queryPrivilegeDomainDenials).mockResolvedValue({ ...response, total: 100 } as any);
    render(<ConsolePrivilegeDomainAuditPage />);
    await screen.findByText('/v1/schemas');
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(api.queryPrivilegeDomainDenials).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })));
  });
});
