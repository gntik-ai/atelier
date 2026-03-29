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

function createContext(overrides: Partial<{ activeTenantId: string | null; activeWorkspaceId: string | null }> = {}) {
  return {
    activeTenantId: 'ten_alpha',
    activeWorkspaceId: 'wrk_alpha',
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

  it('muestra los empty states de tenant y workspace', () => {
    renderPage(createContext({ activeTenantId: null, activeWorkspaceId: null }))
    expect(screen.getByRole('alert')).toHaveTextContent(/selecciona un tenant/i)

    cleanup()
    renderPage(createContext({ activeWorkspaceId: null }))
    expect(screen.getByRole('alert')).toHaveTextContent(/selecciona un workspace/i)
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

    expect(await screen.findByText(/topics kafka/i)).toBeInTheDocument()
    expect((await screen.findAllByText(/orders.created/i)).length).toBeGreaterThan(0)
    expect(screen.getByText(/broker kraft/i)).toBeInTheDocument()
    expect(screen.getByText(/quota agotada/i)).toBeInTheDocument()
    expect(await screen.findByText(/postgres · orders_outbox/i)).toBeInTheDocument()
    expect(screen.getByText(/degraded/i)).toBeInTheDocument()
  })

  it('selecciona topic y carga detail, access y metadata en paralelo', async () => {
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
    expect(screen.getByText(/al menos una vez/i)).toBeInTheDocument()
    expect(screen.getAllByText(/compactar/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText('12').length).toBeGreaterThan(0)
    expect(screen.getAllByText('168').length).toBeGreaterThan(0)
    expect(screen.getAllByText('3').length).toBeGreaterThan(0)
    expect(screen.getByText(/http_publish, sse/i)).toBeInTheDocument()
    expect(screen.getByText(/quota agotada/i)).toBeInTheDocument()
    expect(screen.getByText(/hard/i)).toBeInTheDocument()
    expect(screen.getAllByText(/prefix/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/ten_alpha\./i).length).toBeGreaterThan(0)
  })

  it('muestra Access con bindings y badge rojo para DENY', async () => {
    queueHappyPath()
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByText('orders.created'))
    await user.click(screen.getByRole('button', { name: 'Access' }))

    expect(await screen.findByText(/svc-orders/i)).toBeInTheDocument()
    expect(screen.getByText(/read, write/i)).toBeInTheDocument()
    expect(screen.getByText('ALLOW')).toBeInTheDocument()
    expect(screen.getByText('DENY')).toBeInTheDocument()
    expect(screen.getByText(/prefixed/i)).toBeInTheDocument()
    expect(screen.getByText(/^orders$/i)).toBeInTheDocument()
  })

  it('muestra Metadata, limitaciones técnicas y degrada de forma aislada cuando falla', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url.startsWith('/v1/events/workspaces/wrk_alpha/inventory')) return mockInventory()
      if (url === '/v1/events/topics/res_topic_1') return mockTopicDetail()
      if (url === '/v1/events/topics/res_topic_1/access') return mockAccessPolicy()
      if (url === '/v1/events/topics/res_topic_1/metadata') throw new Error('Metadata degradada')
      if (url === '/v1/events/workspaces/wrk_alpha/bridges/evb_orders') return mockBridge()
      throw new Error(`Unexpected URL ${url}`)
    })
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByText('orders.created'))
    await user.click(screen.getByRole('button', { name: 'Metadata' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/metadata degradada/i)
    expect(screen.queryByText(/svc-orders/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Detail' }))
    expect((await screen.findAllByText('evt.ten_alpha.orders.created')).length).toBeGreaterThan(0)

    cleanup()
    queueHappyPath()
    renderPage()
    const user2 = userEvent.setup()
    await user2.click(await screen.findByText('orders.created'))
    await user2.click(screen.getByRole('button', { name: 'Metadata' }))
    expect(await screen.findByText(/hace 5 minutos/i)).toBeInTheDocument()
    expect(screen.getByText(/1200/i)).toBeInTheDocument()
    expect(screen.getByText(/900/i)).toBeInTheDocument()
    expect(screen.getByText(/provider_managed/i)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/kafka_provider_limit/i)
  })

  it('muestra empty states de inventario y bridges sin ids', async () => {
    queueHappyPath({ inventory: { items: [], counts: { total: 0, active: 0, provisioning: 0, degraded: 0 } } })
    renderPage()
    expect(await screen.findByText(/no hay topics en este workspace/i)).toBeInTheDocument()

    cleanup()
    queueHappyPath({ inventory: { items: [{ ...mockInventory().items[0], operationalMetadata: { bridgeCount: 2 } }] } })
    renderPage()
    expect(await screen.findByText(/la lista de bridges requiere ids expuestos por el inventario/i)).toBeInTheDocument()
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

    expect(await screen.findByRole('alert')).toHaveTextContent(/inventario degradado/i)
    await user.click(screen.getByRole('button', { name: /reintentar/i }))
    expect((await screen.findAllByText(/orders.created/i)).length).toBeGreaterThan(0)
  })

  it('renderiza Publish, envía POST y mantiene el formulario visible tras error', async () => {
    queueHappyPath()
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByText('orders.created'))
    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(await screen.findByLabelText(/payload/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/com.example.event/i)).toBeInTheDocument()
    expect(screen.getByDisplayValue('application/json')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/payload/i), { target: { value: '{"ok":true}' } })
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
      if (url === '/v1/events/topics/res_topic_1/publish') throw new Error('quota exceeded 429')
      throw new Error(`Unexpected URL ${url}`)
    })

    await user.clear(screen.getByLabelText(/payload/i))
    await user.click(screen.getByRole('button', { name: /publicar evento/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/quota exceeded 429/i)
    expect(screen.getByLabelText(/payload/i)).toBeInTheDocument()
    expect(screen.getByText(/detail > quotas/i)).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: 'Stream' }))
    await user.click(screen.getByRole('button', { name: /iniciar stream/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/v1/events/topics/res_topic_1/stream', expect.objectContaining({ headers: { Authorization: 'Bearer token-123' } }))
    })
    expect(await screen.findByText(/conexión activa|inactivo/i)).toBeInTheDocument()
    expect(await screen.findByText(/raw:/i)).toBeInTheDocument()
    expect(await screen.findByText(/"id": 1/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /iniciar stream|detener stream/i })).toBeInTheDocument()
  })

  it('muestra error aislado en stream sin reconexión infinita', async () => {
    queueHappyPath()
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: 'SSE no disponible' }) } as Response)
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByText('orders.created'))
    await user.click(screen.getByRole('button', { name: 'Stream' }))
    await user.click(screen.getByRole('button', { name: /iniciar stream/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/sse no disponible/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('resetea la selección y recarga inventario cuando cambia el contexto', async () => {
    queueHappyPath()
    const user = userEvent.setup()
    const view = renderPage(createContext({ activeWorkspaceId: 'wrk_alpha' }))

    await user.click(await screen.findByText('orders.created'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Detail' })).toBeInTheDocument())

    mockUseConsoleContext.mockReturnValue(createContext({ activeWorkspaceId: 'wrk_beta' }))
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url.startsWith('/v1/events/workspaces/wrk_beta/inventory')) {
        return mockInventory({ workspaceId: 'wrk_beta', items: [{ ...mockInventory().items[0], topicName: 'payments.created', physicalTopicName: 'evt.ten_alpha.payments.created', resourceId: 'res_topic_2', operationalMetadata: { bridgeIds: [] } }] })
      }
      throw new Error(`Unexpected URL ${url}`)
    })

    view.rerender(<ConsoleKafkaPage />)

    expect(await screen.findByText(/^payments\.created$/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Detail' })).not.toBeInTheDocument()
  })
})
