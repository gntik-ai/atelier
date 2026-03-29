import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleStoragePage } from './ConsoleStoragePage'

const mockUseConsoleContext = vi.fn()
const mockRequestConsoleSessionJson = vi.fn()

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: (...args: unknown[]) => mockRequestConsoleSessionJson(...args)
}))

function createContext(overrides: Partial<{ activeTenantId: string | null; activeWorkspaceId: string | null }> = {}) {
  return {
    activeTenantId: 'ten_alpha',
    activeWorkspaceId: 'wrk_alpha',
    ...overrides
  }
}

function mockBuckets(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        resourceId: 'res_bucket_1',
        tenantId: 'ten_alpha',
        workspaceId: 'wrk_alpha',
        bucketName: 'media-assets',
        region: 'eu-west-1',
        status: 'active',
        provisioning: { state: 'active' },
        timestamps: { createdAt: '2026-03-29T06:00:00.000Z' }
      },
      {
        resourceId: 'res_bucket_2',
        tenantId: 'ten_alpha',
        workspaceId: 'wrk_other',
        bucketName: 'other-workspace',
        region: 'eu-west-1',
        status: 'active',
        provisioning: { state: 'active' },
        timestamps: { createdAt: '2026-03-29T06:05:00.000Z' }
      }
    ],
    page: { size: 100 },
    ...overrides
  }
}

function mockObjects(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        resourceId: 'res_obj_1',
        bucketResourceId: 'res_bucket_1',
        bucketName: 'media-assets',
        objectKey: 'media/hero.png',
        contentType: 'image/png',
        sizeBytes: 4096,
        etag: 'etag-hero',
        metadata: { owner: 'design' },
        storageClass: 'standard',
        timestamps: {
          createdAt: '2026-03-29T06:00:00.000Z',
          updatedAt: '2026-03-29T06:10:00.000Z',
          lastModifiedAt: '2026-03-29T06:10:00.000Z'
        }
      }
    ],
    page: { size: 50, nextCursor: 'cursor-next' },
    ...overrides
  }
}

function mockObjectMetadata(overrides: Record<string, unknown> = {}) {
  return {
    resourceId: 'res_obj_1',
    bucketResourceId: 'res_bucket_1',
    bucketName: 'media-assets',
    objectKey: 'media/hero.png',
    contentType: 'image/png',
    sizeBytes: 4096,
    etag: 'etag-hero',
    metadata: { owner: 'design', locale: 'es-ES' },
    storageClass: 'standard',
    checksumSha256: 'abcdef1234567890abcdef1234567890',
    versionId: 'ver_1',
    providerType: 's3',
    applicationId: 'app_alpha',
    namespace: 'public',
    timestamps: {
      createdAt: '2026-03-29T06:00:00.000Z',
      updatedAt: '2026-03-29T06:10:00.000Z',
      lastModifiedAt: '2026-03-29T06:10:00.000Z'
    },
    ...overrides
  }
}

function mockUsage(overrides: Record<string, unknown> = {}) {
  return {
    collectionMethod: 'cached_snapshot',
    collectionStatus: 'ok',
    snapshotAt: '2026-03-29T06:00:00.000Z',
    cacheSnapshotAt: '2026-03-29T06:25:00.000Z',
    dimensions: {
      totalBytes: { dimension: 'total_bytes', used: 8192, limit: 16384, remaining: 8192, utilizationPercent: 50 },
      bucketCount: { dimension: 'bucket_count', used: 1, limit: null, remaining: null, utilizationPercent: null },
      objectCount: { dimension: 'object_count', used: 24, limit: null, remaining: null, utilizationPercent: null },
      objectSizeBytes: { dimension: 'object_size_bytes', used: 8192, limit: null, remaining: null, utilizationPercent: null }
    },
    buckets: [
      {
        bucketId: 'res_bucket_1',
        totalBytes: 8192,
        objectCount: 24,
        largestObjectSizeBytes: 4096
      }
    ],
    ...overrides
  }
}

function renderPage(context = createContext()) {
  mockUseConsoleContext.mockReturnValue(context)
  return render(<ConsoleStoragePage />)
}

function queueHappyPath(options: {
  buckets?: Record<string, unknown>
  objects?: Record<string, unknown>
  metadata?: Record<string, unknown>
  usage?: Record<string, unknown>
} = {}) {
  mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
    if (url === '/v1/storage/buckets?page[size]=100') return mockBuckets(options.buckets)
    if (url === '/v1/storage/workspaces/wrk_alpha/usage') return mockUsage(options.usage)
    if (url === '/v1/storage/buckets/res_bucket_1/objects?page%5Bsize%5D=50') return mockObjects(options.objects)
    if (url === '/v1/storage/buckets/res_bucket_1/objects?page%5Bsize%5D=50&page%5Bafter%5D=cursor-next') {
      return mockObjects({
        items: [
          {
            resourceId: 'res_obj_2',
            bucketResourceId: 'res_bucket_1',
            bucketName: 'media-assets',
            objectKey: 'media/manual.pdf',
            contentType: 'application/pdf',
            sizeBytes: 2048,
            etag: 'etag-pdf',
            metadata: {},
            storageClass: 'standard',
            timestamps: {
              createdAt: '2026-03-29T06:15:00.000Z',
              updatedAt: '2026-03-29T06:20:00.000Z',
              lastModifiedAt: '2026-03-29T06:20:00.000Z'
            }
          }
        ],
        page: { size: 50 }
      })
    }
    if (url === '/v1/storage/buckets/res_bucket_1/objects/media%2Fhero.png/metadata') return mockObjectMetadata(options.metadata)
    throw new Error(`Unexpected URL ${url}`)
  })
}

describe('ConsoleStoragePage', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-29T06:30:00.000Z').getTime())
    mockUseConsoleContext.mockReset()
    mockRequestConsoleSessionJson.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('muestra los guards de tenant y workspace sin llamar APIs', () => {
    renderPage(createContext({ activeTenantId: null, activeWorkspaceId: null }))
    expect(screen.getByRole('alert')).toHaveTextContent(/selecciona un tenant/i)
    expect(mockRequestConsoleSessionJson).not.toHaveBeenCalled()

    cleanup()

    renderPage(createContext({ activeWorkspaceId: null }))
    expect(screen.getByRole('alert')).toHaveTextContent(/selecciona un workspace/i)
    expect(mockRequestConsoleSessionJson).not.toHaveBeenCalled()
  })

  it('carga buckets del workspace activo y muestra uso del workspace', async () => {
    queueHappyPath()

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Buckets' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'media-assets' })).toBeInTheDocument()
    expect(screen.queryByText(/^other-workspace$/i)).not.toBeInTheDocument()
    expect(screen.getByText(/50% · 8.0 KB \/ 16 KB/i)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getAllByText(/^24$/)).toHaveLength(2)
  })

  it('muestra estados empty y error del inventario de buckets', async () => {
    queueHappyPath({ buckets: { items: [], page: { size: 100 } } })
    renderPage()
    expect(await screen.findByText(/no hay buckets en el workspace seleccionado/i)).toBeInTheDocument()

    cleanup()
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/storage/buckets?page[size]=100') throw new Error('Buckets degradados')
      if (url === '/v1/storage/workspaces/wrk_alpha/usage') return mockUsage()
      throw new Error(`Unexpected URL ${url}`)
    })
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(/buckets degradados/i)
  })

  it('selecciona un bucket y carga objetos; la paginación usa el cursor público', async () => {
    queueHappyPath()
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'media-assets' }))

    await waitFor(() => {
      expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/storage/buckets/res_bucket_1/objects?page%5Bsize%5D=50', expect.any(Object))
    })

    expect(await screen.findByRole('button', { name: 'media/hero.png' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /página siguiente/i }))

    await waitFor(() => {
      expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/storage/buckets/res_bucket_1/objects?page%5Bsize%5D=50&page%5Bafter%5D=cursor-next', expect.any(Object))
    })

    expect(await screen.findByRole('button', { name: 'media/manual.pdf' })).toBeInTheDocument()
  })

  it('carga y renderiza el detalle read-only de metadata del objeto', async () => {
    queueHappyPath()
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'media-assets' }))
    await user.click(await screen.findByRole('button', { name: 'media/hero.png' }))

    await waitFor(() => {
      expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/storage/buckets/res_bucket_1/objects/media%2Fhero.png/metadata', expect.any(Object))
    })

    expect(await screen.findByText(/metadata del objeto/i)).toBeInTheDocument()
    expect(screen.getByText(/abcdef1234567890abcdef1234567890/i)).toBeInTheDocument()
    expect(screen.getByText(/^owner$/i)).toBeInTheDocument()
    expect(screen.getByText(/^design$/i)).toBeInTheDocument()
    expect(screen.getByText(/^locale$/i)).toBeInTheDocument()
    expect(screen.getByText(/^es-ES$/i)).toBeInTheDocument()
    expect(screen.getByText(/ver_1/i)).toBeInTheDocument()
  })

  it('muestra degradación de uso sin colapsar la página cuando el proveedor no está disponible o la snapshot es antigua', async () => {
    queueHappyPath({
      usage: {
        collectionStatus: 'provider_unavailable',
        cacheSnapshotAt: '2026-03-29T06:00:00.000Z',
        buckets: []
      }
    })

    renderPage()

    expect(await screen.findByText(/no expone una snapshot de uso disponible/i)).toBeInTheDocument()
    expect(screen.getByText(/la snapshot de uso tiene 30 minutos/i)).toBeInTheDocument()
    expect(screen.getByText(/^media-assets$/i)).toBeInTheDocument()
  })

  it('muestra estados acotados para presigned y multipart al no existir GET públicos', async () => {
    queueHappyPath()
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'media-assets' }))

    await user.click(await screen.findByRole('button', { name: /presigned urls/i }))
    expect(await screen.findByText(/presigned urls no disponible en la api pública actual/i)).toBeInTheDocument()
    expect(screen.getByText(/no usa endpoints no documentados/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /multipart/i }))
    expect(await screen.findByText(/multipart uploads no disponible en la api pública actual/i)).toBeInTheDocument()
  })

  it('mantiene la página utilizable cuando falla la metadata del objeto', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/storage/buckets?page[size]=100') return mockBuckets()
      if (url === '/v1/storage/workspaces/wrk_alpha/usage') return mockUsage()
      if (url === '/v1/storage/buckets/res_bucket_1/objects?page%5Bsize%5D=50') return mockObjects({ page: { size: 50 } })
      if (url === '/v1/storage/buckets/res_bucket_1/objects/media%2Fhero.png/metadata') throw new Error('Metadata degradada')
      throw new Error(`Unexpected URL ${url}`)
    })
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'media-assets' }))
    await user.click(await screen.findByRole('button', { name: 'media/hero.png' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/metadata degradada/i)
    expect(screen.getByText(/storage \/ objetos/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Objetos' })).toBeInTheDocument()
  })

  it('muestra snippets del bucket seleccionado con placeholders cuando falta endpoint', async () => {
    queueHappyPath()
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'media-assets' }))

    expect(await screen.findByRole('heading', { name: 'Snippets de conexión' })).toBeInTheDocument()
    expect(screen.getAllByText(/<RESOURCE_HOST>/).length).toBeGreaterThan(0)
  })
})
