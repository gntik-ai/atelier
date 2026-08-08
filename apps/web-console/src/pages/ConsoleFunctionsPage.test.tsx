import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleFunctionsPage } from './ConsoleFunctionsPage'

const mockUseConsoleContext = vi.fn()
const mockRequestConsoleSessionJson = vi.fn()
const mockReadConsoleShellSession = vi.fn()

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: (...args: unknown[]) => mockRequestConsoleSessionJson(...args),
  readConsoleShellSession: () => mockReadConsoleShellSession()
}))

function createContext(
  overrides: Partial<{
    activeTenantId: string | null
    activeWorkspaceId: string | null
    capabilities: Record<string, boolean>
    capabilitiesLoading: boolean
    workspaces: Array<{ workspaceId: string; tenantId: string; label: string; secondary: string }>
    workspacesLoading: boolean
    workspacesError: string | null
    selectWorkspace: (workspaceId: string | null) => void
    reloadWorkspaces: () => Promise<void>
  }> = {}
) {
  return {
    activeTenantId: 'ten_alpha',
    activeWorkspaceId: 'wrk_alpha',
    capabilities: { public_functions: true },
    capabilitiesLoading: false,
    workspaces: [],
    workspacesLoading: false,
    workspacesError: null,
    selectWorkspace: vi.fn(),
    reloadWorkspaces: vi.fn(),
    ...overrides
  }
}

function inventory(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: 'wrk_alpha',
    counts: { actions: 1, packages: 0, rules: 0, triggers: 0, httpExposures: 0 },
    quotaStatus: { limit: 10, used: 2, remaining: 8, enforcementMode: 'none' },
    actions: [{
      resourceId: 'res_fn_1',
      tenantId: 'ten_alpha',
      workspaceId: 'wrk_alpha',
      actionName: 'hello-fn',
      execution: { runtime: 'nodejs:20', entrypoint: 'index.main', limits: { timeoutMs: 1000, memoryMb: 256 } },
      activationPolicy: { mode: 'workspace_default', retentionDays: 7 },
      source: { kind: 'inline_code', inlineCode: 'exports.main=()=>({ok:true})' },
      status: 'active',
      activeVersionId: 'fnv_1',
      rollbackAvailable: true,
      secretReferences: [],
      unresolvedSecretRefs: 0,
      versionCount: 2,
      timestamps: { createdAt: '2026-03-29T07:00:00.000Z', updatedAt: '2026-03-29T07:30:00.000Z' },
      provisioning: { state: 'active' }
    }],
    ...overrides
  }
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    ...inventory().actions[0],
    httpExposure: { enabled: true, publicUrl: 'https://example.test/fn', authPolicy: 'jwt' },
    kafkaTriggers: [{ triggerId: 'ktr_1', topicRef: 'res_topic_1', deliveryMode: 'per_event', status: 'active' }],
    cronTriggers: [{ triggerId: 'cron_1', schedule: '*/5 * * * *', timezone: 'UTC', status: 'active' }],
    storageTriggers: [{ triggerId: 'str_1', bucketRef: 'res_bucket_1', eventTypes: ['object.created'], status: 'active' }],
    ...overrides
  }
}

function versions(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      { versionId: 'fnv_2', resourceId: 'res_fn_1', versionNumber: 2, status: 'active', originType: 'publish', rollbackEligible: false, activationPolicy: { mode: 'workspace_default' }, source: { kind: 'inline_code' }, execution: { runtime: 'nodejs:20', entrypoint: 'index.main' }, timestamps: { createdAt: '2026-03-29T07:30:00.000Z' } },
      { versionId: 'fnv_1', resourceId: 'res_fn_1', versionNumber: 1, status: 'historical', originType: 'publish', rollbackEligible: true, activationPolicy: { mode: 'workspace_default' }, source: { kind: 'inline_code' }, execution: { runtime: 'nodejs:20', entrypoint: 'index.main' }, timestamps: { createdAt: '2026-03-29T07:00:00.000Z' } }
    ],
    page: { size: 2 },
    ...overrides
  }
}

function activations(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      { activationId: 'act_1', resourceId: 'res_fn_1', status: 'succeeded', startedAt: '2026-03-29T07:40:00.000Z', finishedAt: '2026-03-29T07:40:01.000Z', durationMs: 1000, triggerKind: 'direct' }
    ],
    page: { total: 1 },
    ...overrides
  }
}

function activationLogs(overrides: Record<string, unknown> = {}) {
  return { activationId: 'act_1', lines: ['hello', 'world'], truncated: true, ...overrides }
}

function activationResult(overrides: Record<string, unknown> = {}) {
  return { activationId: 'act_1', status: 'available', result: { ok: true }, ...overrides }
}

function invokeAccepted(overrides: Record<string, unknown> = {}) {
  return { invocationId: 'inv_1', resourceId: 'res_fn_1', status: 'accepted', acceptedAt: '2026-03-29T07:41:00.000Z', ...overrides }
}

function rollbackAccepted(overrides: Record<string, unknown> = {}) {
  return { requestId: 'req_1', resourceId: 'res_fn_1', requestedVersionId: 'fnv_1', status: 'accepted', correlationId: 'corr_1', acceptedAt: '2026-03-29T07:42:00.000Z', ...overrides }
}

function renderPage(context = createContext()) {
  mockUseConsoleContext.mockReturnValue(context)
  return render(
    <MemoryRouter>
      <ConsoleFunctionsPage />
    </MemoryRouter>
  )
}

async function openTab(name: string | RegExp) {
  await userEvent.click(screen.getByRole('tab', { name }))
}

describe('ConsoleFunctionsPage', () => {
  beforeEach(() => {
    mockUseConsoleContext.mockReset()
    mockRequestConsoleSessionJson.mockReset()
    mockReadConsoleShellSession.mockReset()
    mockReadConsoleShellSession.mockReturnValue({ principal: { userId: 'usr_1', platformRoles: ['tenant_owner'] } })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('muestra el guard de organización', () => {
    renderPage(createContext({ activeTenantId: null, activeWorkspaceId: null }))
    expect(screen.getByRole('alert')).toHaveTextContent(/selecciona una organización/i)
  })

  // #742: the no-workspace guard is the shared WorkspaceRequiredState, not a static alert.
  it('[#742] muestra el guard de área de trabajo con la acción en línea compartida', () => {
    renderPage(createContext({ activeWorkspaceId: null }))
    expect(screen.getByRole('status')).toHaveTextContent(/selecciona un área de trabajo/i)
    expect(screen.getByRole('link', { name: /crear área de trabajo/i })).toHaveAttribute('href', '/console/workspaces')
  })

  it('[#742] ofrece un selector en línea que activa el área de trabajo elegida', async () => {
    const user = userEvent.setup()
    const selectWorkspace = vi.fn()
    renderPage(
      createContext({
        activeWorkspaceId: null,
        workspaces: [
          { workspaceId: 'wrk_alpha', tenantId: 'ten_alpha', label: 'App Dev', secondary: 'dev' },
          { workspaceId: 'wrk_beta', tenantId: 'ten_alpha', label: 'App Staging', secondary: 'staging' }
        ],
        selectWorkspace
      })
    )

    await user.selectOptions(screen.getByRole('combobox', { name: /seleccionar área de trabajo/i }), 'wrk_beta')
    expect(selectWorkspace).toHaveBeenCalledWith('wrk_beta')
  })

  it('carga inventario y renderiza la lista', async () => {
    mockRequestConsoleSessionJson.mockResolvedValue(inventory())
    renderPage()

    expect(screen.getByRole('heading', { name: 'Funciones: administrar' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Funciones: despliegue rápido' })).toHaveAttribute('href', '/console/functions/data')
    expect(screen.getByText(/cargando inventario/i)).toBeInTheDocument()
    expect(await screen.findByText('hello-fn')).toBeInTheDocument()
    expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/functions/workspaces/wrk_alpha/inventory', expect.any(Object))
  })

  it('muestra empty state cuando inventory hace fallback a actions vacío', async () => {
    mockRequestConsoleSessionJson.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ items: [] })
    renderPage()

    expect(await screen.findByText(/no hay funciones en esta área de trabajo/i)).toBeInTheDocument()
  })

  // [#743] confirmed-repro shape: a 403 FORBIDDEN must never render the raw backend message,
  // even when both the inventory call and its actions-fallback reject.
  it('[#743] localiza un error 403 del backend al cargar el inventario — nunca el texto crudo', async () => {
    mockRequestConsoleSessionJson.mockRejectedValue({ status: 403, code: 'FORBIDDEN', message: 'requires superadmin' })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/no tienes permiso/i)
    expect(alert.textContent ?? '').not.toMatch(/requires superadmin/i)
  })

  it('selecciona función y carga detalle', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    expect(await screen.findByText('Tiempo de espera (ms)')).toBeInTheDocument()
    expect((await screen.findAllByText(/https:\/\/example.test\/fn/i)).length).toBeGreaterThan(0)
  })

  it('alinea authoring y tabs con primitivas accesibles del console', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      if (url === '/v1/functions/actions/res_fn_1/versions?page[size]=50') return versions()
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()

    const primaryDeploy = screen.getByRole('button', { name: /desplegar función/i })
    expect(primaryDeploy).toHaveClass('bg-primary')
    expect(screen.queryByRole('button', { name: /publicar función/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('capability-gate-badge')).not.toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    expect(await screen.findByText('Tiempo de espera (ms)')).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: /operaciones de función/i })).toBeInTheDocument()

    const activeTone = screen.getAllByText('active').find((element) => (element as HTMLElement).className.includes('emerald'))
    expect(activeTone).toBeDefined()

    const detailTab = screen.getByRole('tab', { name: 'Detalle' })
    expect(detailTab).toHaveAttribute('aria-selected', 'true')
    detailTab.focus()
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Versiones' })).toHaveAttribute('aria-selected', 'true'))
    expect(await screen.findByText('fnv_1')).toBeInTheDocument()

    await openTab('Invocar')
    const payloadEditor = screen.getByLabelText(/contenido json/i)
    expect(payloadEditor).toHaveClass('font-mono')
    expect(payloadEditor).toHaveAttribute('spellcheck', 'false')

    await openTab('Desplegar')
    const codeEditor = screen.getByLabelText(/código inline/i)
    expect(codeEditor).toHaveClass('font-mono')
    expect(codeEditor).toHaveAttribute('spellcheck', 'false')
    expect(screen.getByRole('button', { name: /actualizar función/i })).toHaveClass('bg-primary')
  })

  it('abre lazy versions y rollback deshabilitado sin elegibles', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      if (url === '/v1/functions/actions/res_fn_1/versions?page[size]=50') return versions({ items: [{ ...versions().items[0], rollbackEligible: false }] })
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    await openTab('Versiones')
    expect(await screen.findByText(/no hay versiones anteriores disponibles para revertir/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /revertir/i })).toBeDisabled()
  })

  it('cuando detail indica rollback disponible, versions muestra historial previo y habilita rollback', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      if (url === '/v1/functions/actions/res_fn_1/versions?page[size]=50') return versions()
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    expect(await screen.findByText('Reversión disponible')).toBeInTheDocument()
    expect(screen.getAllByText('Sí').length).toBeGreaterThan(0)

    await openTab('Versiones')
    expect(await screen.findByText('fnv_1')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '1' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /revertir/i })).toBeEnabled()
  })

  it('carga activations y detalle paralelo con logs truncados', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      if (url === '/v1/functions/actions/res_fn_1/activations?page[size]=50') return activations()
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1') return activations().items[0]
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/logs') return activationLogs()
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/result') return activationResult()
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    await openTab('Activaciones')
    await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))

    expect(await screen.findByText(/registros están truncados/i)).toBeInTheDocument()
    expect(screen.getByText(/hello\s+world/)).toBeInTheDocument()
    expect(screen.getByText(/"ok": true/)).toBeInTheDocument()
  })


  it('muestra mensaje de logs vacíos cuando lines está vacío', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      if (url === '/v1/functions/actions/res_fn_1/activations?page[size]=50') return activations()
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1') return activations().items[0]
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/logs') return activationLogs({ lines: [], truncated: false })
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/result') return activationResult()
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    await openTab('Activaciones')
    await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))

    expect(await screen.findByText(/no hay registros disponibles/i)).toBeInTheDocument()
  })

  it('fallo en logs no bloquea metadata ni resultado (RF-FEL-05)', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      if (url === '/v1/functions/actions/res_fn_1/activations?page[size]=50') return activations()
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1') {
        return {
          ...activations().items[0],
          memoryMb: 256,
          invocationId: 'inv_1',
          policy: { retentionDays: 7 }
        }
      }
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/logs') throw Object.assign(new Error('server error'), { status: 500 })
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/result') return activationResult()
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    await openTab('Activaciones')
    await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))

    expect(await screen.findByText(/id de recurso/i)).toBeInTheDocument()
    expect(screen.getByText(/"ok": true/)).toBeInTheDocument()
    // [#743] a 500 renders the shared localized status text — never the raw thrown message.
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/no está disponible en este momento/i)
    expect(alert.textContent ?? '').not.toMatch(/server error/i)
  })

  it('fallo en resultado no bloquea metadata ni logs (RF-FEL-06)', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      if (url === '/v1/functions/actions/res_fn_1/activations?page[size]=50') return activations()
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1') {
        return {
          ...activations().items[0],
          memoryMb: 256,
          invocationId: 'inv_1',
          policy: { retentionDays: 7 }
        }
      }
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/logs') return activationLogs({ truncated: false })
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/result') throw Object.assign(new Error('result unavailable'), { status: 500 })
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    await openTab('Activaciones')
    await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))

    expect(await screen.findByText(/id de recurso/i)).toBeInTheDocument()
    expect(screen.getByText(/hello\s+world/)).toBeInTheDocument()
    // [#743] a 500 renders the shared localized status text — never the raw thrown message.
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/no está disponible en este momento/i)
    expect(alert.textContent ?? '').not.toMatch(/result unavailable/i)
  })

  it('muestra mensaje cuando contentType es octet-stream', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      if (url === '/v1/functions/actions/res_fn_1/activations?page[size]=50') return activations()
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1') return activations().items[0]
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/logs') return activationLogs({ lines: [], truncated: false })
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/result') return activationResult({ contentType: 'application/octet-stream', result: null })
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    await openTab('Activaciones')
    await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))

    expect(await screen.findByText(/no se puede mostrar en texto/i)).toBeInTheDocument()
  })

  it('muestra empty state cuando la función no tiene activaciones (RF-FEL-07)', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      if (url === '/v1/functions/actions/res_fn_1/activations?page[size]=50') return activations({ items: [] })
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    await openTab('Activaciones')

    expect(await screen.findByText(/no tiene activaciones registradas/i)).toBeInTheDocument()
  })

  it('muestra "Sin resultado disponible." cuando result.result es null', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      if (url === '/v1/functions/actions/res_fn_1/activations?page[size]=50') return activations()
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1') return activations().items[0]
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/logs') return activationLogs({ lines: [], truncated: false })
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/result') return activationResult({ result: null, contentType: 'application/json' })
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    await openTab('Activaciones')
    await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))

    expect(await screen.findByText(/sin resultado disponible/i)).toBeInTheDocument()
  })


  it('muestra el resultado text/plain como texto plano', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      if (url === '/v1/functions/actions/res_fn_1/activations?page[size]=50') return activations()
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1') return activations().items[0]
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/logs') return activationLogs({ lines: [], truncated: false })
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/result') return activationResult({ contentType: 'text/plain', result: 'done' })
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    await openTab('Activaciones')
    await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))

    expect(await screen.findByText('done')).toBeInTheDocument()
  })

  it('muestra mensajes de activación en curso cuando aún no hay logs ni resultado', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      if (url === '/v1/functions/actions/res_fn_1/activations?page[size]=50') return activations({
        items: [{ activationId: 'act_1', resourceId: 'res_fn_1', status: 'running', startedAt: '2026-03-29T07:40:00.000Z', durationMs: 1000, triggerKind: 'direct' }]
      })
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1') return { activationId: 'act_1', resourceId: 'res_fn_1', status: 'running', startedAt: '2026-03-29T07:40:00.000Z', durationMs: 1000, triggerKind: 'direct' }
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/logs') return null
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/result') return null
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    await openTab('Activaciones')
    await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))

    expect(await screen.findByText(/registros pueden no estar disponibles aún/i)).toBeInTheDocument()
    expect(screen.getByText(/resultado puede no estar disponible aún/i)).toBeInTheDocument()
  })

  it('mapea 403 de logs al mensaje de permisos', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      if (url === '/v1/functions/actions/res_fn_1/activations?page[size]=50') return activations()
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1') return activations().items[0]
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/logs') throw new Error('403 forbidden')
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/result') return activationResult()
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    await openTab('Activaciones')
    await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))

    expect(await screen.findByText(/no tienes permisos para ver los registros/i)).toBeInTheDocument()
  })

  it('mapea 404 de detalle al mensaje de activación no disponible', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      if (url === '/v1/functions/actions/res_fn_1/activations?page[size]=50') return activations()
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1') throw new Error('404 not found')
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/logs') return activationLogs({ lines: [], truncated: false })
      if (url === '/v1/functions/actions/res_fn_1/activations/act_1/result') return activationResult()
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    await openTab('Activaciones')
    await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))

    expect(await screen.findByText(/esta activación ya no está disponible/i)).toBeInTheDocument()
  })

  it('renderiza los triggers configurados en la pestaña triggers', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    await openTab('Disparadores')

    expect(await screen.findByText('Kafka')).toBeInTheDocument()
    expect(screen.getByText('Cron')).toBeInTheDocument()
    expect(screen.getByText('Almacenamiento')).toBeInTheDocument()
    expect(screen.getByText(/res_topic_1/i)).toBeInTheDocument()
    expect(screen.getByText(/res_bucket_1/i)).toBeInTheDocument()
  })

  it('invoca con éxito y muestra invocation id', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      if (url === '/v1/functions/actions/res_fn_1/invocations') return invokeAccepted()
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    await openTab('Invocar')
    await userEvent.click(screen.getByRole('button', { name: 'Invocar' }))

    expect(await screen.findByText(/inv_1/i)).toBeInTheDocument()
    const [, options] = mockRequestConsoleSessionJson.mock.calls.find((call: unknown[]) => call[0] === '/v1/functions/actions/res_fn_1/invocations') as [string, { headers: Record<string, string> }]
    expect(options.headers['Idempotency-Key']).toBeTruthy()
  })

  it('invoca wait_for_result, refetch activaciones, selecciona la activación y renderiza resultado', async () => {
    const awaitedActivation = {
      activationId: 'act_2',
      resourceId: 'res_fn_1',
      status: 'succeeded',
      startedAt: '2026-03-29T07:45:00.000Z',
      finishedAt: '2026-03-29T07:45:01.000Z',
      durationMs: 1000,
      triggerKind: 'direct',
      invocationId: 'inv_2'
    }

    mockRequestConsoleSessionJson.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      if (url === '/v1/functions/actions/res_fn_1/invocations' && options?.method === 'POST') {
        return invokeAccepted({ invocationId: 'inv_2', activationId: 'act_2', status: 'accepted' })
      }
      if (url === '/v1/functions/actions/res_fn_1/activations?page[size]=50') {
        return activations({ items: [awaitedActivation], page: { total: 1 } })
      }
      if (url === '/v1/functions/actions/res_fn_1/activations/act_2') return awaitedActivation
      if (url === '/v1/functions/actions/res_fn_1/activations/act_2/logs') return activationLogs({ activationId: 'act_2', lines: ['awaited log'], truncated: false })
      if (url === '/v1/functions/actions/res_fn_1/activations/act_2/result') return activationResult({ activationId: 'act_2', result: { awaited: true } })
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    await openTab('Invocar')
    await userEvent.selectOptions(screen.getByLabelText(/modo de respuesta/i), 'wait_for_result')
    await userEvent.click(screen.getByRole('button', { name: 'Invocar' }))

    const [, invokeOptions] = mockRequestConsoleSessionJson.mock.calls.find((call: unknown[]) => call[0] === '/v1/functions/actions/res_fn_1/invocations') as [string, { body: { responseMode: string }; headers: Record<string, string> }]
    expect(invokeOptions.body.responseMode).toBe('wait_for_result')
    expect(invokeOptions.headers['Idempotency-Key']).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Activaciones' })).toHaveAttribute('aria-selected', 'true'))
    expect(await screen.findByText(/"awaited": true/)).toBeInTheDocument()
    expect(screen.getByText('awaited log')).toBeInTheDocument()
    expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/functions/actions/res_fn_1/activations?page[size]=50', expect.any(Object))
  })

  it('muestra error de invoke', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      if (url === '/v1/functions/actions/res_fn_1/invocations') throw new Error('quota exceeded')
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    await openTab('Invocar')
    await userEvent.click(screen.getByRole('button', { name: 'Invocar' }))

    // [#743] a network/unknown-status failure renders the page's own localized fallback —
    // never the raw thrown message.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/no se pudo invocar la función/i)
    expect(alert.textContent ?? '').not.toMatch(/quota exceeded/i)
  })

  it('abre deploy create y envía POST con recarga de inventario', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string, options?: { method?: string; body?: { actionName?: string }; headers?: Record<string, string> }) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions' && options?.method === 'POST') return { resourceId: 'res_fn_2', status: 'accepted' }
      if (url === '/v1/functions/actions/res_fn_2') return detail({ resourceId: 'res_fn_2', actionName: 'new-fn' })
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await screen.findByText('hello-fn')
    await userEvent.click(screen.getByRole('button', { name: /desplegar función/i }))
    await userEvent.type(screen.getByLabelText(/nombre de acción/i), 'new-fn')
    await userEvent.selectOptions(screen.getByLabelText(/entorno/i), 'nodejs:20')
    await userEvent.type(screen.getByLabelText(/punto de entrada/i), 'index.main')
    expect(screen.getByLabelText(/tiempo de espera \(ms\)/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /crear función/i }))

    await waitFor(() => expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/functions/actions', expect.objectContaining({ method: 'POST' })))
  })

  it('prefill de deploy edit', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    await openTab('Desplegar')
    expect(await screen.findByDisplayValue('hello-fn')).toBeDisabled()
    expect(screen.getByDisplayValue('nodejs:20')).toBeInTheDocument()
  })

  it('rollback exitoso recarga detalle y versiones', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      if (url === '/v1/functions/actions/res_fn_1/versions?page[size]=50') return versions()
      if (url === '/v1/functions/actions/res_fn_1/rollback' && options?.method === 'POST') return rollbackAccepted()
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    await openTab('Versiones')
    await screen.findByText('fnv_1')
    await userEvent.click(screen.getByRole('button', { name: /revertir/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/fnv_1/i)
  })

  it('confirma eliminación destructiva, envía DELETE con idempotency key, refresca inventario y limpia selección', async () => {
    let deleted = false
    mockRequestConsoleSessionJson.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') {
        return deleted
          ? inventory({ actions: [], counts: { actions: 0, packages: 0, rules: 0, triggers: 0, httpExposures: 0 } })
          : inventory()
      }
      if (url === '/v1/functions/actions/res_fn_1' && options?.method === 'DELETE') {
        deleted = true
        return { requestId: 'req_delete_1', resourceId: 'res_fn_1', status: 'accepted', acceptedAt: '2026-03-29T07:50:00.000Z' }
      }
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    expect(await screen.findByText('Tiempo de espera (ms)')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /eliminar función/i }))

    const dialog = await screen.findByRole('alertdialog', { name: /eliminar función/i })
    await userEvent.type(within(dialog).getByPlaceholderText('hello-fn'), 'hello-fn')
    await userEvent.click(within(dialog).getByRole('button', { name: /^eliminar$/i }))

    const [, deleteOptions] = await waitFor(() => {
      const call = mockRequestConsoleSessionJson.mock.calls.find((entry: unknown[]) => entry[0] === '/v1/functions/actions/res_fn_1' && (entry[1] as { method?: string } | undefined)?.method === 'DELETE')
      expect(call).toBeTruthy()
      return call as [string, { headers: Record<string, string> }]
    })
    expect(deleteOptions.headers['Idempotency-Key']).toBeTruthy()
    expect(await screen.findByText(/función hello-fn eliminada/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: /hello-fn/i })).not.toBeInTheDocument())
    expect(screen.getByText(/selecciona una función del inventario/i)).toBeInTheDocument()
    expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/functions/workspaces/wrk_alpha/inventory', expect.any(Object))
  })

  it('si DELETE falla conserva fila y selección, y muestra error sin éxito falso', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1' && options?.method === 'DELETE') throw new Error('delete failed')
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    expect(await screen.findByText('Tiempo de espera (ms)')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /eliminar función/i }))

    const dialog = await screen.findByRole('alertdialog', { name: /eliminar función/i })
    await userEvent.type(within(dialog).getByPlaceholderText('hello-fn'), 'hello-fn')
    await userEvent.click(within(dialog).getByRole('button', { name: /^eliminar$/i }))

    // [#743] a network/unknown-status failure renders the page's own localized fallback —
    // never the raw thrown message.
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(/no se pudo eliminar la función/i)
    expect(alert.textContent ?? '').not.toMatch(/delete failed/i)
    expect(screen.queryByText(/función eliminada/i)).not.toBeInTheDocument()
    const remainingInventoryRow = screen.getAllByRole('button', { name: /hello-fn/i }).find((button) => button.textContent?.includes('Entorno:'))
    expect(remainingInventoryRow).toBeInTheDocument()
    expect(screen.getByText('Tiempo de espera (ms)')).toBeInTheDocument()
  })

  it('bloquea escrituras cuando provisioning es provisioning', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory({ actions: [{ ...inventory().actions[0], provisioning: { state: 'provisioning' } }] })
      if (url === '/v1/functions/actions/res_fn_1') return detail({ provisioning: { state: 'provisioning' } })
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    const deleteButton = await screen.findByRole('button', { name: /eliminar función hello-fn/i })
    expect(deleteButton).toBeDisabled()
    expect(deleteButton).toHaveAttribute('aria-describedby', 'functions-write-disabled-reason')
    expect(screen.getByText(/termina de aprovisionarse/i)).toHaveAttribute('id', 'functions-write-disabled-reason')
    await openTab('Invocar')
    const invokeButton = await screen.findByRole('button', { name: 'Invocar' })
    expect(invokeButton).toBeDisabled()
    expect(invokeButton).toHaveAttribute('aria-describedby', 'functions-write-disabled-reason')
    await openTab('Desplegar')
    const deployButton = screen.getByRole('button', { name: /actualizar función/i })
    expect(deployButton).toBeDisabled()
    expect(deployButton).toHaveAttribute('aria-describedby', 'functions-write-disabled-reason')
  })

  it('bloquea escrituras cuando sólo status indica provisioning', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') {
        return inventory({ actions: [{ ...inventory().actions[0], provisioning: undefined, status: 'provisioning' }] })
      }
      if (url === '/v1/functions/actions/res_fn_1') return detail({ provisioning: undefined, status: 'provisioning' })
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))

    expect(await screen.findByRole('button', { name: /eliminar función hello-fn/i })).toBeDisabled()
    expect(screen.getByText(/termina de aprovisionarse/i)).toBeInTheDocument()
  })

  // #933: managed Knative outage — an unavailable runtime makes every write non-actionable and is
  // explained honestly, without claiming the workload is ready.
  it('bloquea y explica escrituras cuando el runtime de Knative no está disponible', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory({ actions: [{ ...inventory().actions[0], status: 'unavailable', provisioning: { state: 'unavailable' } }] })
      if (url === '/v1/functions/actions/res_fn_1') return detail({ status: 'unavailable', provisioning: { state: 'unavailable' } })
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    const deleteButton = await screen.findByRole('button', { name: /eliminar función hello-fn/i })
    expect(deleteButton).toBeDisabled()
    expect(deleteButton).toHaveAttribute('aria-describedby', 'functions-write-disabled-reason')
    expect(screen.getByText(/runtime de knative no está disponible/i)).toHaveAttribute('id', 'functions-write-disabled-reason')
    await openTab('Invocar')
    const invokeButton = await screen.findByRole('button', { name: 'Invocar' })
    expect(invokeButton).toBeDisabled()
    expect(invokeButton).toHaveAttribute('aria-describedby', 'functions-write-disabled-reason')
    await openTab('Desplegar')
    const deployButton = screen.getByRole('button', { name: /actualizar función/i })
    expect(deployButton).toBeDisabled()
    expect(deployButton).toHaveAttribute('aria-describedby', 'functions-write-disabled-reason')
  })

  // #933: a delete during an outage is accepted as `deletion_pending` cleanup, so the resource is
  // non-actionable (no re-delete, invoke, rollback or update) until cleanup resolves.
  it('bloquea y explica escrituras cuando la eliminación de la función está pendiente', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory({ actions: [{ ...inventory().actions[0], status: 'deletion_pending', provisioning: { state: 'deletion_pending' } }] })
      if (url === '/v1/functions/actions/res_fn_1') return detail({ status: 'deletion_pending', provisioning: { state: 'deletion_pending' } })
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    const deleteButton = await screen.findByRole('button', { name: /eliminar función hello-fn/i })
    expect(deleteButton).toBeDisabled()
    expect(deleteButton).toHaveAttribute('aria-describedby', 'functions-write-disabled-reason')
    expect(screen.getByText(/eliminación de la función está pendiente/i)).toHaveAttribute('id', 'functions-write-disabled-reason')
    await openTab('Invocar')
    const invokeButton = await screen.findByRole('button', { name: 'Invocar' })
    expect(invokeButton).toBeDisabled()
    expect(invokeButton).toHaveAttribute('aria-describedby', 'functions-write-disabled-reason')
    await openTab('Desplegar')
    const deployButton = screen.getByRole('button', { name: /actualizar función/i })
    expect(deployButton).toBeDisabled()
    expect(deployButton).toHaveAttribute('aria-describedby', 'functions-write-disabled-reason')
  })

  it('resetea y recarga al cambiar workspace', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/workspaces/wrk_beta/inventory') return inventory({ workspaceId: 'wrk_beta', actions: [] })
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      throw new Error(`Unexpected URL ${url}`)
    })

    const { rerender } = renderPage(createContext({ activeWorkspaceId: 'wrk_alpha' }))
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    expect(screen.getByRole('heading', { name: 'Funciones: administrar' })).toBeInTheDocument()

    mockUseConsoleContext.mockReturnValue(createContext({ activeWorkspaceId: 'wrk_beta' }))
    rerender(
      <MemoryRouter>
        <ConsoleFunctionsPage />
      </MemoryRouter>
    )

    expect(await screen.findByText(/no hay funciones en esta área de trabajo/i)).toBeInTheDocument()
    expect(screen.queryByText('hello-fn')).not.toBeInTheDocument()
  })

  it('muestra snippets HTTP para la función seleccionada', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))

    expect(await screen.findByRole('heading', { name: 'Fragmentos de conexión' })).toBeInTheDocument()
    expect(screen.getAllByText(/https:\/\/example.test\/fn/).length).toBeGreaterThan(0)
  })
})
