import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ConsoleCapabilityCatalogPage } from './ConsoleCapabilityCatalogPage';

describe('ConsoleCapabilityCatalogPage', () => {
  it('renders enabled and disabled capabilities', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      workspaceId: 'ws-123',
      capabilities: [
        {
          id: 'postgres-database',
          displayName: 'PostgreSQL',
          enabled: true,
          status: 'active',
          examples: [{ operationId: 'connect', label: 'Connect', language: 'nodejs', code: 'const client = new Client()' }]
        },
        {
          id: 'mongo-collection',
          displayName: 'MongoDB',
          enabled: false,
          status: 'disabled',
          enablementGuide: 'Contact your workspace administrator to enable MongoDB.',
          examples: []
        }
      ]
    });

    render(<ConsoleCapabilityCatalogPage workspaceId="ws-123" fetcher={fetcher} />);

    await waitFor(() => expect(screen.getByText('PostgreSQL')).toBeInTheDocument());
    expect(screen.getByText('const client = new Client()')).toBeInTheDocument();
    expect(screen.getByText('Contact your workspace administrator to enable MongoDB.')).toBeInTheDocument();
  });

  it('renders loading state', () => {
    const fetcher = vi.fn(() => new Promise(() => {}));
    render(<ConsoleCapabilityCatalogPage workspaceId="ws-123" fetcher={fetcher} />);
    expect(screen.getByTestId('catalog-loading')).toBeInTheDocument();
  });

  it('renders error state', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('boom'));
    render(<ConsoleCapabilityCatalogPage workspaceId="ws-123" fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('Failed to load capability catalog.')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('renders transitional status badge', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      workspaceId: 'ws-123',
      capabilities: [
        {
          id: 'postgres-database',
          displayName: 'PostgreSQL',
          enabled: true,
          status: 'provisioning',
          examples: [{ operationId: 'connect', label: 'Connect', language: 'nodejs', code: 'await connect()' }]
        }
      ]
    });

    render(<ConsoleCapabilityCatalogPage workspaceId="ws-123" fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByText('provisioning')).toBeInTheDocument());
  });
});
