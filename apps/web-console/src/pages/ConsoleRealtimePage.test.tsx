import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleRealtimePage, mapChannelTypes } from './ConsoleRealtimePage'

const requestConsoleSessionJsonMock = vi.fn()
const panelSpy = vi.fn()

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: (...args: unknown[]) => requestConsoleSessionJsonMock(...args)
}))

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => ({ activeWorkspaceId: 'ws-fallback' })
}))

vi.mock('@/components/console/snippets/RealtimeSnippetsPanel', () => ({
  RealtimeSnippetsPanel: (props: unknown) => {
    panelSpy(props)
    return <div>Realtime panel mock</div>
  }
}))

describe('ConsoleRealtimePage', () => {
  beforeEach(() => {
    requestConsoleSessionJsonMock.mockReset()
    panelSpy.mockReset()
  })

  function renderPage(path = '/console/workspaces/ws_123/realtime') {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/console/workspaces/:workspaceId/realtime" element={<ConsoleRealtimePage />} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('muestra loading mientras carga', () => {
    requestConsoleSessionJsonMock.mockReturnValue(new Promise(() => undefined))
    renderPage()
    expect(screen.getByTestId('realtime-loading-skeleton')).toBeInTheDocument()
  })

  it('renderiza panel con props correctas en éxito', async () => {
    requestConsoleSessionJsonMock.mockResolvedValue({
      workspaceId: 'ws_123',
      realtimeEndpointUrl: 'wss://rt.example.test',
      features: { realtime: true },
      dataSources: [{ type: 'postgresql' }]
    })

    renderPage()

    expect(await screen.findByText('Realtime panel mock')).toBeInTheDocument()
    expect(panelSpy).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_123',
      realtimeEndpoint: 'wss://rt.example.test',
      channelTypes: ['postgresql-changes'],
      realtimeEnabled: true
    }))
  })

  it('renderiza error si falla la carga', async () => {
    requestConsoleSessionJsonMock.mockRejectedValue(new Error('boom'))
    renderPage()
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByText(/boom/i)).toBeInTheDocument()
  })

  it('mapea correctamente tipos de canal', () => {
    expect(mapChannelTypes([{ type: 'postgresql' }, { type: 'mongodb' }, { type: 'unknown' }])).toEqual(['postgresql-changes', 'mongodb-changes'])
  })

  it('pasa realtimeEnabled false cuando el feature está desactivado', async () => {
    requestConsoleSessionJsonMock.mockResolvedValue({
      workspaceId: 'ws_123',
      realtimeEndpointUrl: 'wss://rt.example.test',
      features: { realtime: false },
      dataSources: [{ type: 'postgresql' }]
    })

    renderPage()
    await screen.findByText('Realtime panel mock')
    expect(panelSpy).toHaveBeenCalledWith(expect.objectContaining({ realtimeEnabled: false }))
  })
})
