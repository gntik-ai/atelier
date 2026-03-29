import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConnectionSnippets } from './ConnectionSnippets'

import { SNIPPET_CATALOG } from '@/lib/snippets/snippet-catalog'
import {
  SNIPPET_CTX_FUNCTION,
  SNIPPET_CTX_IAM_CLIENT,
  SNIPPET_CTX_MONGO,
  SNIPPET_CTX_NO_ENDPOINT,
  SNIPPET_CTX_POSTGRES,
  SNIPPET_CTX_PROVISIONING,
  SNIPPET_CTX_STORAGE
} from '@/test/fixtures/snippets'
import { FIXTURE_TENANT_BETA, FIXTURE_WORKSPACE_B1 } from '@/test/fixtures/tenants'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ConnectionSnippets', () => {
  it('renderiza la sección para tipos soportados', () => {
    render(<ConnectionSnippets resourceType="postgres-database" context={SNIPPET_CTX_POSTGRES} />)

    expect(screen.getByRole('heading', { name: 'Snippets de conexión' })).toBeInTheDocument()
    expect(screen.getByText('Node.js — pg')).toBeInTheDocument()
  })

  it('no renderiza nada cuando no hay snippets', () => {
    const { container } = render(<ConnectionSnippets resourceType={('unsupported-type' as never)} context={SNIPPET_CTX_POSTGRES} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('[RS-02] host y puerto del fixture aparecen en el snippet — RF-UI-029 / T05-AC2', () => {
    render(<ConnectionSnippets resourceType="postgres-database" context={SNIPPET_CTX_POSTGRES} />)
    expect(screen.getAllByText((content) => content.includes('db.example.test') && content.includes('5432')).length).toBeGreaterThan(0)
  })

  it('[RS-03] ningún snippet expone contraseña real — RF-UI-029 / T05-AC3', () => {
    render(<ConnectionSnippets resourceType="postgres-database" context={SNIPPET_CTX_POSTGRES} />)

    const codeBlocks = screen.getAllByText((content, node) => node?.tagName.toLowerCase() === 'code' && content.length > 0)
    const serialized = codeBlocks.map((node) => node.textContent ?? '').join('\n')

    expect(serialized).toMatch(/<PG_USER>|\{PASSWORD\}|<PASSWORD>/)
    expect(serialized).not.toMatch(/super-secret|password=real|secret=real|AKIA[0-9A-Z]{16}|[A-Za-z0-9+/]{32,}/)
  })

  it('copia el snippet correcto al portapapeles', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    render(<ConnectionSnippets resourceType="iam-client" context={SNIPPET_CTX_IAM_CLIENT} />)

    await user.click(screen.getByRole('button', { name: 'Copiar' }))

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('client_secret=<CLIENT_SECRET>'))
    expect(screen.getByRole('button', { name: 'Copiado ✓' })).toBeInTheDocument()
  })

  it('resetea el feedback visual tras el timeout', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    render(<ConnectionSnippets resourceType="serverless-function" context={SNIPPET_CTX_FUNCTION} />)

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

    render(<ConnectionSnippets resourceType="storage-bucket" context={SNIPPET_CTX_STORAGE} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Copiar' })[0])

    expect(screen.getByText(/selecciona y copia el bloque manualmente/i)).toBeInTheDocument()
  })

  it('[RS-05] sin endpoint muestra placeholders y nota — RF-UI-029 / T05-AC5', () => {
    render(<ConnectionSnippets resourceType="postgres-database" context={SNIPPET_CTX_NO_ENDPOINT} />)

    expect(screen.getByText(/si el endpoint aún no aparece en la consola/i)).toBeInTheDocument()
    expect(screen.getAllByText((content) => content.includes('<RESOURCE_HOST>') || content.includes('<RESOURCE_PORT>')).length).toBeGreaterThan(0)
  })

  it('[RS-06] estado provisioning muestra advertencia — RF-UI-029 / T05-AC6', () => {
    render(<ConnectionSnippets resourceType="postgres-database" context={SNIPPET_CTX_PROVISIONING} />)
    expect(screen.getAllByText(/recurso sigue provisionando|provisioning|endpoint aún no aparece/i).length).toBeGreaterThan(0)
  })

  it('muestra advertencias y placeholders secretos sin fugas', () => {
    render(<ConnectionSnippets resourceType="serverless-function" context={{ ...SNIPPET_CTX_FUNCTION, externalAccessEnabled: false, resourceState: 'degraded' }} />)

    expect(screen.getAllByText(/acceso externo está deshabilitado/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/añade tu token\/api key real/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/<API_TOKEN>/).length).toBeGreaterThan(0)
  })

  it('[RS-08] cobertura de lenguajes por tipo de recurso — RF-UI-029 / T05-AC8', () => {
    const scenarios = [
      ['postgres-database', SNIPPET_CTX_POSTGRES],
      ['mongo-collection', SNIPPET_CTX_MONGO],
      ['storage-bucket', SNIPPET_CTX_STORAGE],
      ['serverless-function', SNIPPET_CTX_FUNCTION],
      ['iam-client', SNIPPET_CTX_IAM_CLIENT]
    ] as const

    for (const [resourceType, context] of scenarios) {
      const { unmount } = render(<ConnectionSnippets resourceType={resourceType} context={context} />)
      for (const template of SNIPPET_CATALOG[resourceType]) {
        expect(screen.getByText(template.label)).toBeInTheDocument()
      }
      unmount()
    }
  })

  it('aisla el contexto multi-tenant activo', () => {
    render(<ConnectionSnippets resourceType="postgres-database" context={SNIPPET_CTX_POSTGRES} />)

    const section = screen.getByRole('heading', { name: 'Snippets de conexión' }).closest('section')
    expect(section).not.toBeNull()
    const scoped = within(section as HTMLElement)
    expect(scoped.queryByText(FIXTURE_TENANT_BETA.tenantId)).not.toBeInTheDocument()
    expect(scoped.queryByText(FIXTURE_WORKSPACE_B1.workspaceSlug)).not.toBeInTheDocument()
  })
})
