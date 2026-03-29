import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConnectionSnippets } from './ConnectionSnippets'

import type { SnippetContext } from '@/lib/snippets/snippet-types'

const baseContext: SnippetContext = {
  tenantId: 'ten_alpha',
  tenantSlug: 'tenant-alpha',
  workspaceId: 'wrk_alpha',
  workspaceSlug: 'workspace-alpha',
  resourceName: 'orders',
  resourceHost: 'db.example.test',
  resourcePort: 5432,
  resourceExtraA: 'public',
  resourceExtraB: 'https://functions.example.test/hello',
  resourceState: 'active',
  externalAccessEnabled: true
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ConnectionSnippets', () => {
  it('renderiza la sección para tipos soportados', () => {
    render(<ConnectionSnippets resourceType="postgres-database" context={baseContext} />)

    expect(screen.getByRole('heading', { name: 'Snippets de conexión' })).toBeInTheDocument()
    expect(screen.getByText('Node.js — pg')).toBeInTheDocument()
  })

  it('no renderiza nada cuando no hay snippets', () => {
    const { container } = render(<ConnectionSnippets resourceType={('unsupported-type' as never)} context={baseContext} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('copia el snippet correcto al portapapeles', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    render(<ConnectionSnippets resourceType="iam-client" context={{ ...baseContext, resourceName: 'atelier-console', resourceExtraB: 'https://sso.example.test/token' }} />)

    await user.click(screen.getByRole('button', { name: 'Copiar' }))

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('client_secret=<CLIENT_SECRET>'))
    expect(screen.getByRole('button', { name: 'Copiado ✓' })).toBeInTheDocument()
  })

  it('resetea el feedback visual tras el timeout', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    render(<ConnectionSnippets resourceType="serverless-function" context={baseContext} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Copiar' })[0])
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copiado ✓' })).toBeInTheDocument()
    })

    await new Promise((resolve) => setTimeout(resolve, 2600))

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Copiar' }).length).toBeGreaterThan(0)
    })
  }, 8000)

  it('muestra fallback cuando Clipboard API no está disponible', () => {
    vi.stubGlobal('navigator', {})

    render(<ConnectionSnippets resourceType="storage-bucket" context={baseContext} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Copiar' })[0])

    expect(screen.getByText(/selecciona y copia el bloque manualmente/i)).toBeInTheDocument()
  })

  it('muestra advertencias y placeholders secretos sin fugas', () => {
    render(<ConnectionSnippets resourceType="serverless-function" context={{ ...baseContext, externalAccessEnabled: false, resourceState: 'degraded' }} />)

    expect(screen.getAllByText(/acceso externo está deshabilitado/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Añade tu token\/API key real/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/<API_TOKEN>/).length).toBeGreaterThan(0)
  })
})
