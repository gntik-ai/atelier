import '@testing-library/jest-dom/vitest'
import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RealtimeSnippetsPanel } from './RealtimeSnippetsPanel'

const writeText = vi.fn().mockResolvedValue(undefined)

describe('RealtimeSnippetsPanel', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    writeText.mockClear()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    window.sessionStorage.clear()
  })

  function renderPanel(props?: Partial<ComponentProps<typeof RealtimeSnippetsPanel>>) {
    return render(
      <MemoryRouter>
        <RealtimeSnippetsPanel
          workspaceId="ws-test"
          realtimeEndpoint="wss://rt.example.test"
          channelTypes={['postgresql-changes', 'mongodb-changes']}
          realtimeEnabled
          {...props}
        />
      </MemoryRouter>
    )
  }

  it('renderiza guard cuando realtimeEnabled es false', () => {
    renderPanel({ realtimeEnabled: false })
    expect(screen.getByRole('alert')).toHaveTextContent(/Realtime subscriptions require at least one provisioned data source/i)
    expect(screen.queryByText(/WebSocket subscription/i)).not.toBeInTheDocument()
  })

  it('renderiza guard cuando no hay channelTypes', () => {
    renderPanel({ channelTypes: [] })
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('incluye link a provisioning', () => {
    renderPanel({ realtimeEnabled: false })
    expect(screen.getByRole('link', { name: /go to provisioning/i })).toHaveAttribute('href', '/console/workspaces/ws-test/provisioning')
  })

  it('usa JavaScript por defecto', () => {
    renderPanel()
    expect(screen.getByRole('tab', { name: 'JavaScript' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByText(/const ws = new WebSocket/i).length).toBeGreaterThan(0)
  })

  it('lee sessionStorage al montar', () => {
    window.sessionStorage.setItem('realtime-snippet-lang', 'nodejs')
    renderPanel()
    expect(screen.getByRole('tab', { name: 'Node.js' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByText(/import WebSocket from 'ws'/i).length).toBeGreaterThan(0)
  })

  it('escribe sessionStorage al cambiar de pestaña', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('tab', { name: 'Python' }))
    expect(window.sessionStorage.getItem('realtime-snippet-lang')).toBe('python')
    expect(screen.getAllByText(/import asyncio/i).length).toBeGreaterThan(0)
  })

  it('muestra snippets node y python al cambiar de pestaña', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('tab', { name: 'Node.js' }))
    expect(screen.getAllByText(/Authorization: `Bearer \$\{SERVICE_ACCOUNT_TOKEN\}`/i).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('tab', { name: 'Python' }))
    expect(screen.getAllByText(/asyncio.run/i).length).toBeGreaterThan(0)
  })

  it('muestra la nota de canales adicionales', () => {
    renderPanel()
    expect(screen.getByText(/Additional channel types available: mongodb-changes/i)).toBeInTheDocument()
  })

  it('permite copiar con teclado', async () => {
    renderPanel()
    const copyButtons = screen.getAllByRole('button', { name: /copiar/i })
    copyButtons[0].focus()
    fireEvent.click(copyButtons[0])
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(await screen.findByText(/Snippet copiado al portapapeles/i)).toBeInTheDocument()
  })

  it('mantiene semántica accesible mínima de tabs y tabpanel', () => {
    renderPanel()
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tabpanel')).toBeInTheDocument()
  })
})
