import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseConsoleContext = vi.fn();
vi.mock('../lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}));
vi.mock('../services/privilege-domain-api', () => ({
  queryPrivilegeDomainDenials: vi.fn()
}));

import ConsolePrivilegeDomainAuditPage from './ConsolePrivilegeDomainAuditPage';
import * as api from '../services/privilege-domain-api';

const query = api.queryPrivilegeDomainDenials as unknown as ReturnType<typeof vi.fn>;

function ctx(activeTenantId: string | null, activeWorkspaceId: string | null) {
  return { activeTenantId, activeWorkspaceId };
}

function denial(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    tenantId: 'ten_a',
    workspaceId: 'wrk_a',
    actorId: 'actor-1',
    actorType: 'user',
    credentialDomain: 'data_access',
    requiredDomain: 'structural_admin',
    httpMethod: 'POST',
    requestPath: '/v1/schemas',
    sourceIp: '1.2.3.4',
    correlationId: 'corr-1',
    deniedAt: new Date().toISOString(),
    ...overrides
  };
}

function response(rows: unknown[], total = rows.length) {
  return { denials: rows, total, limit: 50, offset: 0 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const exportEl = () => screen.getByText('Exportar CSV');

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue(response([]));
  mockUseConsoleContext.mockReturnValue(ctx('ten_a', 'wrk_a'));
});

afterEach(() => {
  cleanup();
});

describe('ConsolePrivilegeDomainAuditPage — context-required (no request)', () => {
  it('presents a tenant-context-required state and issues no request when no active tenant', async () => {
    mockUseConsoleContext.mockReturnValue(ctx(null, null));
    render(<ConsolePrivilegeDomainAuditPage />);
    expect(screen.getByTestId('privilege-domain-audit-tenant-required')).toBeTruthy();
    expect(query).not.toHaveBeenCalled();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('presents a workspace-context-required state and issues no request when tenant but no workspace', async () => {
    mockUseConsoleContext.mockReturnValue(ctx('ten_a', null));
    render(<ConsolePrivilegeDomainAuditPage />);
    expect(screen.getByTestId('privilege-domain-audit-workspace-required')).toBeTruthy();
    expect(query).not.toHaveBeenCalled();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('ConsolePrivilegeDomainAuditPage — active scope drives the request', () => {
  it('requests exactly the active tenant/workspace scope and renders the rows', async () => {
    query.mockResolvedValueOnce(response([denial()], 1));
    render(<ConsolePrivilegeDomainAuditPage />);
    await screen.findByText('/v1/schemas');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenLastCalledWith(
      'wrk_a',
      expect.objectContaining({ tenantId: 'ten_a', limit: 50, offset: 0 })
    );
  });

  it('a required-domain filter change re-requests the SAME scope with the filter and offset reset', async () => {
    query.mockResolvedValueOnce(response([denial()], 1));
    render(<ConsolePrivilegeDomainAuditPage />);
    await screen.findByText('/v1/schemas');
    fireEvent.change(screen.getByLabelText('Dominio requerido'), { target: { value: 'structural_admin' } });
    await waitFor(() =>
      expect(query).toHaveBeenLastCalledWith(
        'wrk_a',
        expect.objectContaining({ tenantId: 'ten_a', requiredDomain: 'structural_admin', offset: 0 })
      )
    );
  });

  it('an actor filter change forwards the actor and keeps the active scope', async () => {
    query.mockResolvedValueOnce(response([denial()], 1));
    render(<ConsolePrivilegeDomainAuditPage />);
    await screen.findByText('/v1/schemas');
    fireEvent.change(screen.getByLabelText('ID del actor'), { target: { value: 'actor-9' } });
    await waitFor(() =>
      expect(query).toHaveBeenLastCalledWith('wrk_a', expect.objectContaining({ actorId: 'actor-9' }))
    );
  });

  it('paging next advances the offset by the current limit within the active scope', async () => {
    query.mockResolvedValue(response([denial()], 100));
    render(<ConsolePrivilegeDomainAuditPage />);
    await screen.findByText('/v1/schemas');
    fireEvent.click(screen.getByText('Siguiente'));
    await waitFor(() =>
      expect(query).toHaveBeenLastCalledWith('wrk_a', expect.objectContaining({ offset: 50 }))
    );
  });

  it('computes the 24h denial badge from the current rows', async () => {
    query.mockResolvedValueOnce(response([denial()], 1));
    render(<ConsolePrivilegeDomainAuditPage />);
    await screen.findByText('/v1/schemas');
    expect(screen.getByTestId('denial-badge').textContent).toBe('1');
  });

  it('exposes a CSV export derived from the current rows', async () => {
    query.mockResolvedValueOnce(response([denial()], 1));
    render(<ConsolePrivilegeDomainAuditPage />);
    await screen.findByText('/v1/schemas');
    const link = exportEl();
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toContain('data:text/csv');
  });

  it('keeps the documented CSV columns and escapes quotes and commas in row values', async () => {
    query.mockResolvedValueOnce(response([denial({ requestPath: 'GET "/danger", now' })], 1));
    render(<ConsolePrivilegeDomainAuditPage />);
    await screen.findByText('GET "/danger", now');

    const href = exportEl().getAttribute('href');
    expect(href).toBeTruthy();
    const csv = decodeURIComponent(href!.slice(href!.indexOf(',') + 1));
    expect(csv.split('\n')[0]).toBe('deniedAt,actorId,actorType,credentialDomain,requiredDomain,httpMethod,requestPath,sourceIp,correlationId');
    expect(csv).toContain('"GET \\"/danger\\", now"');
  });
});

describe('ConsolePrivilegeDomainAuditPage — scope isolation and stale responses', () => {
  it('clears prior-tenant rows, badge, and CSV synchronously before the new tenant request', async () => {
    query.mockResolvedValueOnce(response([denial({ requestPath: '/ten-a-row' })], 1));
    const { rerender } = render(<ConsolePrivilegeDomainAuditPage />);
    await screen.findByText('/ten-a-row');
    expect(exportEl().tagName).toBe('A');

    const pending = deferred<ReturnType<typeof response>>();
    query.mockReturnValueOnce(pending.promise as never);
    mockUseConsoleContext.mockReturnValue(ctx('ten_b', 'wrk_a'));
    rerender(<ConsolePrivilegeDomainAuditPage />);

    // Old scope data is gone BEFORE the ten_b response arrives.
    expect(screen.queryByText('/ten-a-row')).toBeNull();
    expect(screen.getByTestId('denial-badge').textContent).toBe('0');
    expect(exportEl().tagName).toBe('BUTTON');
    expect(query).toHaveBeenLastCalledWith('wrk_a', expect.objectContaining({ tenantId: 'ten_b' }));

    await act(async () => {
      pending.resolve(response([denial({ id: 'd2', requestPath: '/ten-b-row' })], 1));
    });
    await screen.findByText('/ten-b-row');
  });

  it('clears prior-workspace rows synchronously before the new workspace request', async () => {
    query.mockResolvedValueOnce(response([denial({ requestPath: '/wrk-a-row' })], 1));
    const { rerender } = render(<ConsolePrivilegeDomainAuditPage />);
    await screen.findByText('/wrk-a-row');

    const pending = deferred<ReturnType<typeof response>>();
    query.mockReturnValueOnce(pending.promise as never);
    mockUseConsoleContext.mockReturnValue(ctx('ten_a', 'wrk_b'));
    rerender(<ConsolePrivilegeDomainAuditPage />);

    expect(screen.queryByText('/wrk-a-row')).toBeNull();
    expect(query).toHaveBeenLastCalledWith('wrk_b', expect.objectContaining({ tenantId: 'ten_a' }));
    await act(async () => {
      pending.resolve(response([], 0));
    });
  });

  it('on request failure keeps prior rows cleared and shows the error, with CSV disabled', async () => {
    query.mockResolvedValueOnce(response([denial()], 1));
    render(<ConsolePrivilegeDomainAuditPage />);
    await screen.findByText('/v1/schemas');

    query.mockRejectedValueOnce({ status: 500 });
    fireEvent.change(screen.getByLabelText('Dominio requerido'), { target: { value: 'data_access' } });

    await screen.findByRole('alert');
    expect(screen.queryByText('/v1/schemas')).toBeNull();
    expect(screen.getByTestId('denial-badge').textContent).toBe('0');
    expect(exportEl().tagName).toBe('BUTTON');
  });

  it('discards a superseded response from a previous scope', async () => {
    const first = deferred<ReturnType<typeof response>>();
    query.mockReturnValueOnce(first.promise as never);
    const { rerender } = render(<ConsolePrivilegeDomainAuditPage />);
    expect(query).toHaveBeenCalledWith('wrk_a', expect.objectContaining({ tenantId: 'ten_a' }));

    const second = deferred<ReturnType<typeof response>>();
    query.mockReturnValueOnce(second.promise as never);
    mockUseConsoleContext.mockReturnValue(ctx('ten_b', 'wrk_a'));
    rerender(<ConsolePrivilegeDomainAuditPage />);

    // The stale ten_a response resolves AFTER ten_b started — it must not repopulate.
    await act(async () => {
      first.resolve(response([denial({ requestPath: '/stale-ten-a' })], 1));
    });
    expect(screen.queryByText('/stale-ten-a')).toBeNull();

    await act(async () => {
      second.resolve(response([denial({ id: 'd2', requestPath: '/current-ten-b' })], 1));
    });
    await screen.findByText('/current-ten-b');
    expect(screen.queryByText('/stale-ten-a')).toBeNull();
  });
});

describe('ConsolePrivilegeDomainAuditPage — accessibility', () => {
  it('names controls and table, associates column headers, and disables impossible pagination', async () => {
    query.mockResolvedValueOnce(response([denial()], 1));
    render(<ConsolePrivilegeDomainAuditPage />);
    expect(screen.getByRole('heading', { name: /denegaciones de dominios de privilegio/i })).toBeTruthy();
    expect(await screen.findByRole('table', { name: /historial de denegaciones de dominios de privilegio/i })).toBeTruthy();
    expect(screen.getByLabelText('Dominio requerido')).toBeTruthy();
    expect(screen.getByLabelText('ID del actor')).toBeTruthy();
    expect(screen.getAllByRole('columnheader')).toHaveLength(9);
    for (const header of screen.getAllByRole('columnheader')) {
      expect(header).toHaveAttribute('scope', 'col');
    }
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();

    cleanup();
    mockUseConsoleContext.mockReturnValue(ctx(null, null));
    render(<ConsolePrivilegeDomainAuditPage />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  // Complements the consolidated a11y test above with the two properties it does not assert: that the
  // localized names REPLACED the raw camelCase keys (not merely added alongside them), and that the
  // first-page "Anterior" lock is released once the user leaves offset 0.
  it('replaces the raw field-key labels with localized names and re-enables "Anterior" after leaving the first page', async () => {
    query.mockResolvedValue(response([denial()], 100));
    render(<ConsolePrivilegeDomainAuditPage />);
    await screen.findByText('/v1/schemas');

    expect(screen.queryByLabelText('requiredDomain')).toBeNull();
    expect(screen.queryByLabelText('actorId')).toBeNull();

    const previous = () => screen.getByRole('button', { name: 'Anterior' }) as HTMLButtonElement;
    expect(previous().disabled).toBe(true);

    fireEvent.click(screen.getByText('Siguiente'));
    await waitFor(() =>
      expect(query).toHaveBeenLastCalledWith('wrk_a', expect.objectContaining({ offset: 50 }))
    );
    expect(previous().disabled).toBe(false);
  });
});
