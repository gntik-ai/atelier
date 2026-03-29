import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleFunctionsPage } from './ConsoleFunctionsPage'

const mockUseConsoleContext = vi.fn()
const mockRequestConsoleSessionJson = vi.fn()

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: (...args: unknown[]) => mockRequestConsoleSessionJson(...args)
}))

function createContext(overrides: Partial<{ activeTenantId: string | null; activeWorkspaceId: string | null }> = {}) {
  return { activeTenantId: 'ten_alpha', activeWorkspaceId: 'wrk_alpha', ...overrides }
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
    page: { total: 2 },
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
  return render(<ConsoleFunctionsPage />)
}

describe('ConsoleFunctionsPage', () => {
  beforeEach(() => {
    mockUseConsoleContext.mockReset()
    mockRequestConsoleSessionJson.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('muestra los guards de tenant y workspace', () => {
    renderPage(createContext({ activeTenantId: null, activeWorkspaceId: null }))
    expect(screen.getByRole('alert')).toHaveTextContent(/selecciona un tenant/i)

    cleanup()
    renderPage(createContext({ activeWorkspaceId: null }))
    expect(screen.getByRole('alert')).toHaveTextContent(/selecciona un workspace/i)
  })

  it('carga inventario y renderiza la lista', async () => {
    mockRequestConsoleSessionJson.mockResolvedValue(inventory())
    renderPage()

    expect(screen.getByText(/cargando inventario/i)).toBeInTheDocument()
    expect(await screen.findByText('hello-fn')).toBeInTheDocument()
    expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/functions/workspaces/wrk_alpha/inventory', expect.any(Object))
  })

  it('muestra empty state cuando inventory hace fallback a actions vacío', async () => {
    mockRequestConsoleSessionJson.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ items: [] })
    renderPage()

    expect(await screen.findByText(/no hay funciones en este workspace/i)).toBeInTheDocument()
  })

  it('selecciona función y carga detalle', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory()
      if (url === '/v1/functions/actions/res_fn_1') return detail()
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    expect(await screen.findByText(/https:\/\/example.test\/fn/i)).toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('button', { name: 'Versions' }))
    expect(await screen.findByText(/no hay versiones anteriores disponibles para rollback/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /rollback/i })).toBeDisabled()
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
    await userEvent.click(screen.getByRole('button', { name: 'Activations' }))
    await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))

    expect(await screen.findByText(/logs están truncados/i)).toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('button', { name: 'Activations' }))
    await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))

    expect(await screen.findByText(/no hay logs disponibles/i)).toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('button', { name: 'Activations' }))
    await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))

    expect(await screen.findByText(/resource id/i)).toBeInTheDocument()
    expect(screen.getByText(/"ok": true/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/server error/i)
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
    await userEvent.click(screen.getByRole('button', { name: 'Activations' }))
    await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))

    expect(await screen.findByText(/resource id/i)).toBeInTheDocument()
    expect(screen.getByText(/hello\s+world/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/result unavailable/i)
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
    await userEvent.click(screen.getByRole('button', { name: 'Activations' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Activations' }))

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
    await userEvent.click(screen.getByRole('button', { name: 'Activations' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Activations' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Activations' }))
    await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))

    expect(await screen.findByText(/logs pueden no estar disponibles aún/i)).toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('button', { name: 'Activations' }))
    await userEvent.click(await screen.findByRole('button', { name: /act_1/i }))

    expect(await screen.findByText(/no tienes permisos para ver los logs/i)).toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('button', { name: 'Activations' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Triggers' }))

    expect(await screen.findByText('Kafka')).toBeInTheDocument()
    expect(screen.getByText('Cron')).toBeInTheDocument()
    expect(screen.getByText('Storage')).toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('button', { name: 'Invoke' }))
    await userEvent.click(screen.getByRole('button', { name: /invocar/i }))

    expect(await screen.findByText(/inv_1/i)).toBeInTheDocument()
    const [, options] = mockRequestConsoleSessionJson.mock.calls.find((call: unknown[]) => call[0] === '/v1/functions/actions/res_fn_1/invocations') as [string, { headers: Record<string, string> }]
    expect(options.headers['Idempotency-Key']).toBeTruthy()
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
    await userEvent.click(screen.getByRole('button', { name: 'Invoke' }))
    await userEvent.click(screen.getByRole('button', { name: /invocar/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/quota exceeded/i)
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
    await userEvent.click(screen.getByRole('button', { name: /deploy nueva función/i }))
    await userEvent.type(screen.getByLabelText(/action name/i), 'new-fn')
    await userEvent.type(screen.getByLabelText(/runtime/i), 'nodejs:20')
    await userEvent.type(screen.getByLabelText(/entrypoint/i), 'index.main')
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
    await userEvent.click(screen.getByRole('button', { name: 'Deploy' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Versions' }))
    await screen.findByText('fnv_1')
    await userEvent.click(screen.getByRole('button', { name: /rollback/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/fnv_1/i)
  })

  it('bloquea escrituras cuando provisioning es provisioning', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/functions/workspaces/wrk_alpha/inventory') return inventory({ actions: [{ ...inventory().actions[0], provisioning: { state: 'provisioning' } }] })
      if (url === '/v1/functions/actions/res_fn_1') return detail({ provisioning: { state: 'provisioning' } })
      throw new Error(`Unexpected URL ${url}`)
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /hello-fn/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Invoke' }))
    expect(await screen.findByRole('button', { name: /invocar/i })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Deploy' }))
    expect(screen.getByRole('button', { name: /actualizar función/i })).toBeDisabled()
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
    expect(screen.getByText(/consola de funciones/i)).toBeInTheDocument()

    mockUseConsoleContext.mockReturnValue(createContext({ activeWorkspaceId: 'wrk_beta' }))
    rerender(<ConsoleFunctionsPage />)

    expect(await screen.findByText(/no hay funciones en este workspace/i)).toBeInTheDocument()
    expect(screen.queryByText('hello-fn')).not.toBeInTheDocument()
  })
})
