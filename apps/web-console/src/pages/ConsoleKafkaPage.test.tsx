import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleKafkaPage } from './ConsoleKafkaPage'

const mockUseConsoleContext = vi.fn()
const mockRequestConsoleSessionJson = vi.fn()
const mockReadConsoleShellSession = vi.fn()
const fetchMock = vi.fn<typeof fetch>()

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
    workspaces: [],
    workspacesLoading: false,
    workspacesError: null,
    selectWorkspace: vi.fn(),
    reloadWorkspaces: vi.fn(),
    ...overrides
  }
}

function mockInventory(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: 'wrk_alpha',
    tenantId: 'ten_alpha',
    brokerMode: 'kraft',
    isolationMode: 'shared_cluster',
    counts: { total: 1, active: 1, provisioning: 0, degraded: 0 },
    namingPolicy: { topicPrefix: 'evt.' },
    quotaStatus: { limit: 10, used: 3, remaining: 7, enforcementMode: 'none' },
    tenantIsolation: { mode: 'prefix', topicPrefix: 'ten_alpha.' },
    items: [
      {
        resourceId: 'res_topic_1',
        topicName: 'orders.created',
        physicalTopicName: 'evt.ten_alpha.orders.created',
        status: 'active',
        provisioning: { state: 'ACTIVE' },
        cleanupPolicy: 'compact',
        partitionCount: 12,
        retentionHours: 168,
        quotaStatus: { limit: 100, used: 40, remaining: 60, enforcementMode: 'none', maxPublishesPerSecond: 25, maxConcurrentSubscriptions: 12 },
        operationalMetadata: { bridgeIds: ['evb_orders'] }
      }
    ],
    ...overrides
  }
}

function mockTopicDetail(overrides: Record<string, unknown> = {}) {
  return {
    resourceId: 'res_topic_1',
    topicName: 'orders.created',
    physicalTopicName: 'evt.ten_alpha.orders.created',
    channelPrefix: '/events/orders',
    partitionCount: 12,
    replicationFactor: 3,
    retentionHours: 168,
    cleanupPolicy: 'compact',
    deliverySemantics: 'at_least_once',
    partitionStrategy: 'producer_key',
    partitionSelectionPolicy: 'caller_hint',
    replayWindowHours: 24,
    maxPublishesPerSecond: 25,
    maxConcurrentSubscriptions: 12,
    allowedTransports: ['http_publish', 'sse'],
    provisioning: { state: 'ACTIVE' },
    quotaStatus: { limit: 100, used: 100, remaining: 0, enforcementMode: 'hard', maxPublishesPerSecond: 25, maxConcurrentSubscriptions: 12 },
    tenantIsolation: { mode: 'prefix', topicPrefix: 'ten_alpha.', consumerGroupPrefix: 'cg.ten_alpha.', crossTenantAccessPrevented: true },
    payloadPolicy: { maxPayloadBytes: 4096, compressionHint: 'gzip', schemaValidation: 'none' },
    replayPolicy: { enabled: true, storageBackend: 's3', maxReplayWindowHours: 24 },
    notificationPolicy: { queuesEnabled: true, maxQueueDepth: 50, retentionHours: 12 },
    timestamps: { createdAt: '2026-03-29T05:00:00.000Z', updatedAt: '2026-03-29T06:00:00.000Z' },
    ...overrides
  }
}

function mockAccessPolicy(overrides: Record<string, unknown> = {}) {
  return {
    resourceId: 'res_topic_1',
    topicName: 'orders.created',
    physicalTopicName: 'evt.ten_alpha.orders.created',
    auditMode: 'metadata_only',
    providerCompatibility: { provider: 'kafka', nativeAclSupport: true },
    aclBindings: [
      {
        principal: 'svc-orders',
        operations: ['READ', 'WRITE'],
        permission: 'ALLOW',
        patternType: 'LITERAL',
        resourceName: 'orders.created',
        workspaceScoped: true
      },
      {
        principal: 'svc-denied',
        operations: ['DELETE'],
        permission: 'DENY',
        patternType: 'PREFIXED',
        resourceName: 'orders',
        workspaceScoped: false
      }
    ],
    ...overrides
  }
}

function mockMetadata(overrides: Record<string, unknown> = {}) {
  return {
    resourceId: 'res_topic_1',
    sampledAt: '2026-03-29T06:30:00.000Z',
    lag: { totalLag: 1200, maxPartitionLag: 900, consumerGroupId: 'cg-orders', isActive: true },
    retention: { retentionHours: 168, retentionBytes: 1024, effectivePolicy: 'provider_managed' },
    compaction: { enabled: true, lastCompactionTimestamp: '2026-03-29T06:00:00.000Z', compactionLag: 15 },
    partitionMetadata: {
      '0': { lag: 600, logStartOffset: 10, logEndOffset: 610, inSync: true },
      '1': { lag: 300, logStartOffset: 20, logEndOffset: 320, inSync: false }
    },
    technicalLimitations: [{ code: 'KAFKA_PROVIDER_LIMIT', description: 'Metadata parcial' }],
    ...overrides
  }
}

function mockBridge(overrides: Record<string, unknown> = {}) {
  return {
    bridgeId: 'evb_orders',
    topicRef: 'res_topic_1',
    status: 'DEGRADED',
    source: { sourceType: 'postgres', sourceRef: 'orders_outbox' },
    delivery: { mode: 'at_least_once' },
    audit: { enabled: true },
    ...overrides
  }
}

function mockPublishAccepted(overrides: Record<string, unknown> = {}) {
  return {
    publicationId: 'pub_123',
    status: 'accepted',
    acceptedAt: '2026-03-29T06:45:00.000Z',
    topicName: 'orders.created',
    ...overrides
  }
}

function renderPage(context = createContext()) {
  mockUseConsoleContext.mockReturnValue(context)
  return render(<ConsoleKafkaPage />)
}

function queueHappyPath(options: { inventory?: Record<string, unknown>; detail?: Record<string, unknown>; access?: Record<string, unknown>; metadata?: Record<string, unknown>; bridge?: Record<string, unknown> } = {}) {
  mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
    if (url.startsWith('/v1/events/workspaces/wrk_alpha/inventory')) return mockInventory(options.inventory)
    if (url === '/v1/events/topics/res_topic_1') return mockTopicDetail(options.detail)
    if (url === '/v1/events/topics/res_topic_1/access') return mockAccessPolicy(options.access)
    if (url === '/v1/events/topics/res_topic_1/metadata') return mockMetadata(options.metadata)
    if (url === '/v1/events/workspaces/wrk_alpha/bridges/evb_orders') return mockBridge(options.bridge)
    if (url === '/v1/events/topics/res_topic_1/publish') return mockPublishAccepted()
    throw new Error(`Unexpected URL ${url}`)
  })
}

function createSseStream(chunks: string[]) {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(new TextEncoder().encode(chunks[index]))
      index += 1
    }
  })
}

describe('ConsoleKafkaPage', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-29T06:35:00.000Z').getTime())
    mockRequestConsoleSessionJson.mockReset()
    mockUseConsoleContext.mockReset()
    mockReadConsoleShellSession.mockReset()
    fetchMock.mockReset()
    mockReadConsoleShellSession.mockReturnValue({ tokenSet: { accessToken: 'token-123' } })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('muestra el empty state de tenant', () => {
    renderPage(createContext({ activeTenantId: null, activeWorkspaceId: null }))
    expect(screen.getByRole('alert')).toHaveTextContent(/selecciona una organización/i)
  })

  // #742: the no-workspace guard is the shared WorkspaceRequiredState, not a static `<p role="alert">`.
  it('[#742] muestra el guard de área de trabajo con la acción en línea compartida', () => {
    renderPage(createContext({ activeWorkspaceId: null }))
    expect(screen.getByRole('status')).toHaveTextContent(/selecciona un área de trabajo/i)
    expect(screen.getByTestId('workspace-required-create-denied')).toBeInTheDocument()
  })

  it('carga inventario, muestra quota agotada y carga bridges', async () => {
    queueHappyPath({
      inventory: {
        counts: { total: 1, active: 1, provisioning: 0, degraded: 0 },
        items: [
          {
            ...mockInventory().items[0],
            quotaStatus: { limit: 100, used: 100, remaining: 0, enforcementMode: 'hard' }
          }
        ]
      }
    })

    renderPage()

    expect(await screen.findByText(/tópicos kafka/i)).toBeInTheDocument()
    expect((await screen.findAllByText(/orders.created/i)).length).toBeGreaterThan(0)
    expect(screen.getByText(/broker kraft/i)).toBeInTheDocument()
    expect(screen.getByText(/cuota agotada/i)).toBeInTheDocument()
    expect(await screen.findByText(/postgres · orders_outbox/i)).toBeInTheDocument()
    expect(screen.getAllByText(/degradado/i).length).toBeGreaterThan(0)
  })

  it('selecciona tópico y carga detalle, acceso y metadatos en paralelo', async () => {
    queueHappyPath()
    const user = userEvent.setup()

    renderPage()

    await user.click(await screen.findByText('orders.created'))

    await waitFor(() => {
      expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/events/topics/res_topic_1', expect.any(Object))
      expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/events/topics/res_topic_1/access', expect.any(Object))
      expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/events/topics/res_topic_1/metadata', expect.any(Object))
    })

    expect((await screen.findAllByText('evt.ten_alpha.orders.created')).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/al menos una vez/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/compactar/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText('12').length).toBeGreaterThan(0)
    expect(screen.getAllByText('168').length).toBeGreaterThan(0)
    expect(screen.getAllByText('3').length).toBeGreaterThan(0)
    expect(screen.getByText(/http_publish, sse/i)).toBeInTheDocument()
    expect(screen.getByText(/cuota agotada/i)).toBeInTheDocument()
    expect(screen.getByText(/estricto/i)).toBeInTheDocument()
    expect(screen.getAllByText(/prefijo/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/ten_alpha\./i).length).toBeGreaterThan(0)
  })

  it('muestra Acceso con bindings y badge rojo para DENY', async () => {
    queueHappyPath()
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByText('orders.created'))
    await user.click(screen.getByRole('button', { name: 'Acceso' }))

    expect(await screen.findByText(/svc-orders/i)).toBeInTheDocument()
    expect(screen.getByText(/read, write/i)).toBeInTheDocument()
    expect(screen.getByText('ALLOW')).toBeInTheDocument()
    expect(screen.getByText('DENY')).toBeInTheDocument()
    expect(screen.getByText(/prefixed/i)).toBeInTheDocument()
    expect(screen.getByText(/^orders$/i)).toBeInTheDocument()
  })

  it('muestra Metadatos, limitaciones técnicas y degrada de forma aislada cuando falla', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url.startsWith('/v1/events/workspaces/wrk_alpha/inventory')) return mockInventory()
      if (url === '/v1/events/topics/res_topic_1') return mockTopicDetail()
      if (url === '/v1/events/topics/res_topic_1/access') return mockAccessPolicy()
      if (url === '/v1/events/topics/res_topic_1/metadata') throw new Error('Metadatos degradados')
      if (url === '/v1/events/workspaces/wrk_alpha/bridges/evb_orders') return mockBridge()
      throw new Error(`Unexpected URL ${url}`)
    })
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByText('orders.created'))
    await user.click(screen.getByRole('button', { name: 'Metadatos' }))

    // [#743] localized fallback, never the raw thrown message.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/no se pudieron cargar los metadatos operacionales del tópico/i)
    expect(alert.textContent ?? '').not.toMatch(/metadatos degradados/i)
    expect(screen.queryByText(/svc-orders/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Detalle' }))
    expect((await screen.findAllByText('evt.ten_alpha.orders.created')).length).toBeGreaterThan(0)

    cleanup()
    queueHappyPath()
    renderPage()
    const user2 = userEvent.setup()
    await user2.click(await screen.findByText('orders.created'))
    await user2.click(screen.getByRole('button', { name: 'Metadatos' }))
    expect(await screen.findByText(/hace 5 minutos/i)).toBeInTheDocument()
    expect(screen.getByText(/1200/i)).toBeInTheDocument()
    expect(screen.getByText(/900/i)).toBeInTheDocument()
    expect(screen.getByText(/gestionado por proveedor/i)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/kafka_provider_limit/i)
  })

  it('muestra empty states de inventario y bridges sin ids', async () => {
    queueHappyPath({ inventory: { items: [], counts: { total: 0, active: 0, provisioning: 0, degraded: 0 } } })
    renderPage()
    expect(await screen.findByText(/no hay tópicos en esta área de trabajo/i)).toBeInTheDocument()

    cleanup()
    queueHappyPath({ inventory: { items: [{ ...mockInventory().items[0], operationalMetadata: { bridgeCount: 2 } }] } })
    renderPage()
    expect(await screen.findByText(/la lista de puentes requiere ids expuestos por el inventario/i)).toBeInTheDocument()
  })

  it('permite reintentar cuando falla el inventario', async () => {
    let attempt = 0
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url.startsWith('/v1/events/workspaces/wrk_alpha/inventory')) {
        attempt += 1
        if (attempt === 1) {
          throw new Error('Inventario degradado')
        }
        return mockInventory()
      }
      if (url === '/v1/events/workspaces/wrk_alpha/bridges/evb_orders') return mockBridge()
      throw new Error(`Unexpected URL ${url}`)
    })
    const user = userEvent.setup()

    renderPage()

    // [#743] localized fallback, never the raw thrown message.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/no se pudo cargar el inventario de kafka/i)
    expect(alert.textContent ?? '').not.toMatch(/inventario degradado/i)
    await user.click(screen.getByRole('button', { name: /reintentar/i }))
    expect((await screen.findAllByText(/orders.created/i)).length).toBeGreaterThan(0)
  })

  it('renderiza Publicar, envía POST y mantiene el formulario visible tras error', async () => {
    queueHappyPath()
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByText('orders.created'))
    await user.click(screen.getByRole('button', { name: 'Publicar' }))

    expect(await screen.findByLabelText(/contenido json/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/com.example.event/i)).toBeInTheDocument()
    expect(screen.getByDisplayValue('application/json')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/contenido json/i), { target: { value: '{"ok":true}' } })
    await user.type(screen.getByPlaceholderText(/com.example.event/i), 'com.example.event')
    await user.click(screen.getByRole('button', { name: /publicar evento/i }))

    expect(await screen.findByText(/pub_123/i)).toBeInTheDocument()
    expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/events/topics/res_topic_1/publish', expect.objectContaining({ method: 'POST' }))

    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url.startsWith('/v1/events/workspaces/wrk_alpha/inventory')) return mockInventory()
      if (url === '/v1/events/topics/res_topic_1') return mockTopicDetail()
      if (url === '/v1/events/topics/res_topic_1/access') return mockAccessPolicy()
      if (url === '/v1/events/topics/res_topic_1/metadata') return mockMetadata()
      if (url === '/v1/events/workspaces/wrk_alpha/bridges/evb_orders') return mockBridge()
      // [#743] the quota-guidance heuristic used to sniff the raw backend message for "quota"/
      // "429" — now it reads the actual HTTP status, so the thrown error must carry one.
      if (url === '/v1/events/topics/res_topic_1/publish') throw { status: 429, code: 'RATE_LIMITED', message: 'quota exceeded 429' }
      throw new Error(`Unexpected URL ${url}`)
    })

    await user.clear(screen.getByLabelText(/contenido json/i))
    await user.click(screen.getByRole('button', { name: /publicar evento/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/se alcanzó el límite de solicitudes/i)
    expect(alert.textContent ?? '').not.toMatch(/quota exceeded 429/i)
    expect(screen.getByLabelText(/contenido json/i)).toBeInTheDocument()
    expect(screen.getByText(/detalle > cuotas/i)).toBeInTheDocument()
  })

  it('inicia stream, parsea eventos SSE y lo detiene', async () => {
    queueHappyPath()
    fetchMock.mockResolvedValue({
      ok: true,
      body: createSseStream(['data: {"key":"k1","eventType":"order.created","payload":{"id":1}}\n\n'])
    } as Response)

    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByText('orders.created'))
    await user.click(screen.getByRole('button', { name: 'Flujo' }))
    await user.click(screen.getByRole('button', { name: /iniciar flujo/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/v1/events/topics/res_topic_1/stream', expect.any(Object))
    })
    const headers = new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers)
    expect(headers.get('authorization')).toBe('Bearer token-123')
    expect(headers.get('x-api-version')).toBe('2026-03-26')
    expect(headers.get('x-correlation-id')).toMatch(/^[A-Za-z0-9._:-]{8,128}$/)
    expect(await screen.findByText(/conexión activa|inactivo/i)).toBeInTheDocument()
    expect(await screen.findByText(/crudo:/i)).toBeInTheDocument()
    expect(await screen.findByText(/"id": 1/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /iniciar flujo|detener flujo/i })).toBeInTheDocument()
  })

  it('muestra error aislado en stream sin reconexión infinita', async () => {
    queueHappyPath()
    // [#743] the SSE endpoint returns a raw Response, so the response's raw `message` must
    // never be echoed — only the shared localized copy (here, the network/unmapped-status
    // fallback, since the mock carries no explicit `status`).
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: 'SSE no disponible' }) } as Response)
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByText('orders.created'))
    await user.click(screen.getByRole('button', { name: 'Flujo' }))
    await user.click(screen.getByRole('button', { name: /iniciar flujo/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/no se pudo iniciar el flujo/i)
    expect(alert.textContent ?? '').not.toMatch(/sse no disponible/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('resetea la selección y recarga inventario cuando cambia el contexto', async () => {
    queueHappyPath()
    const user = userEvent.setup()
    const view = renderPage(createContext({ activeWorkspaceId: 'wrk_alpha' }))

    await user.click(await screen.findByText('orders.created'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Detalle' })).toBeInTheDocument())

    mockUseConsoleContext.mockReturnValue(createContext({ activeWorkspaceId: 'wrk_beta' }))
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url.startsWith('/v1/events/workspaces/wrk_beta/inventory')) {
        return mockInventory({ workspaceId: 'wrk_beta', items: [{ ...mockInventory().items[0], topicName: 'payments.created', physicalTopicName: 'evt.ten_alpha.payments.created', resourceId: 'res_topic_2', operationalMetadata: { bridgeIds: [] } }] })
      }
      throw new Error(`Unexpected URL ${url}`)
    })

    view.rerender(<ConsoleKafkaPage />)

    expect(await screen.findByText(/^payments\.created$/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Detalle' })).not.toBeInTheDocument()
  })
})
