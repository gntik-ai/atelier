import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ConsoleRuntimePage } from './ConsoleRuntimePage'

const getStatus = vi.fn()
vi.mock('@/services/knativeRuntimeApi', () => ({ getKnativeRuntimeStatus: () => getStatus() }))

const ready = { mode: 'managed', owner: 'platform', version: '1.22.1', compatibility: 'compatible', state: 'ready', stage: 'ready', reason: 'READY', lastTransitionAt: '2026-08-07T10:00:00Z' }
function renderPage() { return render(<MemoryRouter><ConsoleRuntimePage /></MemoryRouter>) }

describe('ConsoleRuntimePage', () => {
  beforeEach(() => { getStatus.mockReset() })
  it('presents runtime hierarchy and read-only links', async () => {
    getStatus.mockResolvedValue(ready); renderPage()
    expect(await screen.findByRole('heading', { name: 'Runtime de funciones' })).toBeInTheDocument()
    expect(screen.getByText('platform')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Inspeccionar Funciones' })).toHaveAttribute('href', '/console/functions')
    expect(screen.getByRole('link', { name: 'Inspeccionar Hosted MCP' })).toHaveAttribute('href', '/console')
  })
  it('announces degraded reason without inventing correlation data', async () => {
    getStatus.mockResolvedValue({ ...ready, state: 'degraded', reason: 'WEBHOOK_NOT_READY' }); renderPage()
    expect(await screen.findByText('Degradado')).toBeInTheDocument()
    expect(screen.getByText(/operaciones dependientes no están disponibles/i)).toBeInTheDocument()
    expect(screen.queryByText('WEBHOOK_NOT_READY')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copiar' })).not.toBeInTheDocument()
  })
  it('offers retry on transport errors', async () => {
    getStatus.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(ready); renderPage()
    const retry = await screen.findByRole('button', { name: 'Reintentar' }); await userEvent.click(retry)
    await waitFor(() => expect(screen.getByText('Estado actual')).toBeInTheDocument())
  })
})
