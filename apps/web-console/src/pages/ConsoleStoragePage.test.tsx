import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleStoragePage } from './ConsoleStoragePage'

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
  return render(<ConsoleStoragePage />, { wrapper: MemoryRouter })
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
    mockReadConsoleShellSession.mockReset()
    mockReadConsoleShellSession.mockReturnValue({ principal: { userId: 'usr_1', platformRoles: ['tenant_owner'] } })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('muestra el guard de organización sin llamar APIs', () => {
    renderPage(createContext({ activeTenantId: null, activeWorkspaceId: null }))
    expect(screen.getByRole('alert')).toHaveTextContent(/selecciona una organización/i)
    expect(mockRequestConsoleSessionJson).not.toHaveBeenCalled()
  })

  // #742: the no-workspace guard is the shared WorkspaceRequiredState, not a static `<p role="alert">`.
  it('[#742] muestra el guard de área de trabajo con la acción en línea compartida, sin llamar APIs', () => {
    renderPage(createContext({ activeWorkspaceId: null }))
    expect(screen.getByRole('status')).toHaveTextContent(/selecciona un área de trabajo/i)
    expect(mockRequestConsoleSessionJson).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: /crear área de trabajo/i })).toHaveAttribute('href', '/console/workspaces')
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

  // C-16: switching to a workspace whose usage read now returns 404 must clear the prior
  // workspace's usage snapshot (bytes/objects/quota bar) and render the localized error state —
  // never leave a misleading zero or the previous figures on screen.
  it('[C-16] limpia el uso previo del área de trabajo ante un 404 de alcance', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/storage/buckets?page[size]=100') return mockBuckets()
      if (url === '/v1/storage/workspaces/wrk_alpha/usage') return mockUsage()
      if (url === '/v1/storage/workspaces/wrk_beta/usage') {
        throw Object.assign(new Error('workspace not found'), { status: 404 })
      }
      if (url === '/v1/storage/buckets/res_bucket_1/objects?page%5Bsize%5D=50') return mockObjects()
      if (url === '/v1/storage/buckets/res_bucket_1/objects/media%2Fhero.png/metadata') return mockObjectMetadata()
      throw new Error(`Unexpected URL ${url}`)
    })

    const view = renderPage(createContext({ activeWorkspaceId: 'wrk_alpha' }))
    expect(await screen.findByText(/50% · 8.0 KB \/ 16 KB/i)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')

    mockUseConsoleContext.mockReturnValue(createContext({ activeWorkspaceId: 'wrk_beta' }))
    view.rerender(<ConsoleStoragePage />)

    expect(await screen.findByText(/no se encontró el recurso solicitado/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument()
    expect(screen.queryByText(/50% · 8.0 KB \/ 16 KB/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('muestra estados empty y error del inventario de buckets', async () => {
    queueHappyPath({ buckets: { items: [], page: { size: 100 } } })
    renderPage()
    expect(await screen.findByText(/no hay buckets en el área de trabajo seleccionada/i)).toBeInTheDocument()

    cleanup()
    mockRequestConsoleSessionJson.mockImplementation(async (url: string) => {
      if (url === '/v1/storage/buckets?page[size]=100') throw new Error('Buckets degradados')
      if (url === '/v1/storage/workspaces/wrk_alpha/usage') return mockUsage()
      throw new Error(`Unexpected URL ${url}`)
    })
    renderPage()
    // [#743] A network/unknown-status failure renders the page's own localized fallback —
    // never the raw thrown message.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/no se pudo cargar el inventario de buckets/i)
    expect(alert.textContent ?? '').not.toMatch(/buckets degradados/i)
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

  it('carga y renderiza el detalle read-only de metadatos del objeto', async () => {
    queueHappyPath()
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'media-assets' }))
    await user.click(await screen.findByRole('button', { name: 'media/hero.png' }))

    await waitFor(() => {
      expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/storage/buckets/res_bucket_1/objects/media%2Fhero.png/metadata', expect.any(Object))
    })

    expect(await screen.findByText(/metadatos del objeto/i)).toBeInTheDocument()
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

    expect(await screen.findByText(/no expone una instantánea de uso disponible/i)).toBeInTheDocument()
    expect(screen.getByText(/la instantánea de uso tiene 30 minutos/i)).toBeInTheDocument()
    expect(screen.getByText(/^media-assets$/i)).toBeInTheDocument()
  })

  it('ofrece la generación de URLs prefirmadas y mantiene multipart acotado (#676)', async () => {
    queueHappyPath()
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'media-assets' }))

    // Presigned tab is now an on-demand generator (issuance is wired), not an unsupported state.
    await user.click(await screen.findByRole('tab', { name: /urls prefirmadas/i }))
    expect(await screen.findByRole('heading', { name: /urls prefirmadas/i })).toBeInTheDocument()
    // With no object selected yet, it prompts the user to pick one in the Objetos tab.
    expect(screen.getByText(/selecciona un objeto en la pestaña/i)).toBeInTheDocument()

    // Multiparte still has no public inventory endpoint, so it stays in the bounded solo lectura state.
    await user.click(screen.getByRole('tab', { name: /multiparte/i }))
    expect(await screen.findByText(/cargas multiparte no disponible en la api pública actual/i)).toBeInTheDocument()
  })

  it('genera una URL de descarga prefirmada para el objeto seleccionado (#676)', async () => {
    const presignUrl = '/v1/storage/buckets/res_bucket_1/objects/media%2Fhero.png/presign'
    mockRequestConsoleSessionJson.mockImplementation(async (url: string, init?: { method?: string; body?: unknown }) => {
      if (url === '/v1/storage/buckets?page[size]=100') return mockBuckets()
      if (url === '/v1/storage/workspaces/wrk_alpha/usage') return mockUsage()
      if (url === '/v1/storage/buckets/res_bucket_1/objects?page%5Bsize%5D=50') return mockObjects()
      if (url === '/v1/storage/buckets/res_bucket_1/objects/media%2Fhero.png/metadata') return mockObjectMetadata()
      if (url === presignUrl) {
        expect(init?.method).toBe('POST')
        expect(init?.body).toMatchObject({ operation: 'download' })
        return {
          url: 'http://storage.example.test/media-assets/media/hero.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef',
          operation: 'download', bucketName: 'media-assets', objectKey: 'media/hero.png',
          expiresAt: '2026-03-29T06:35:00.000Z', ttlSeconds: 300, ttlClamped: false
        }
      }
      throw new Error(`Unexpected URL ${url}`)
    })
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'media-assets' }))
    // Select an object, then switch to the presigned tab and generate.
    await user.click(await screen.findByRole('button', { name: 'media/hero.png' }))
    await user.click(await screen.findByRole('tab', { name: /urls prefirmadas/i }))
    await user.click(await screen.findByRole('button', { name: /generar url de descarga prefirmada/i }))

    expect(await screen.findByText(/X-Amz-Signature=deadbeef/i)).toBeInTheDocument()
    expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith(presignUrl, expect.objectContaining({ method: 'POST' }))
  })

  // #758: deleting a bucket is now CRITICAL-guarded by the shared destructive-op confirmation
  // dialog — the DELETE must NOT fire until the operator types the exact bucket name and confirms.
  it('exige confirmación explícita (nombre exacto) antes de eliminar un bucket (#758)', async () => {
    let bucketsEmptied = false
    mockRequestConsoleSessionJson.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === '/v1/storage/buckets?page[size]=100') return bucketsEmptied ? { items: [], page: { size: 0 } } : mockBuckets()
      if (url === '/v1/storage/workspaces/wrk_alpha/usage') return mockUsage(bucketsEmptied ? { buckets: [] } : {})
      if (url === '/v1/storage/buckets/res_bucket_1/objects?page%5Bsize%5D=50') return mockObjects()
      if (url === '/v1/storage/buckets/res_bucket_1' && init?.method === 'DELETE') { bucketsEmptied = true; return { bucket: 'media-assets', deleted: true } }
      throw new Error(`Unexpected URL ${url} (${init?.method ?? 'GET'})`)
    })
    const user = userEvent.setup()

    renderPage()
    await screen.findByRole('button', { name: 'media-assets' })
    // The first row's Eliminar button targets res_bucket_1 (media-assets, owned by wrk_alpha).
    await user.click((await screen.findAllByRole('button', { name: /^eliminar$/i }))[0])

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/media-assets/i)
    expect(dialog).toHaveTextContent(/todos sus objetos/i)
    expect(dialog).toHaveTextContent(/irreversible/i)

    // Opening the dialog must NOT have sent the DELETE yet.
    expect(mockRequestConsoleSessionJson).not.toHaveBeenCalledWith('/v1/storage/buckets/res_bucket_1', expect.objectContaining({ method: 'DELETE' }))

    // CRITICAL ops require typing the exact resource name before the confirm button enables.
    await user.type(screen.getByPlaceholderText('media-assets'), 'media-assets')
    // The footer confirm button (also labelled "Eliminar") is the last match.
    const confirmButtons = screen.getAllByRole('button', { name: /^eliminar$/i })
    await user.click(confirmButtons[confirmButtons.length - 1])

    await waitFor(() => expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/storage/buckets/res_bucket_1', expect.objectContaining({ method: 'DELETE' })))
    expect(await screen.findByText(/no hay buckets en el área de trabajo seleccionada/i)).toBeInTheDocument()
  })

  it('el estado vacío de buckets ofrece crear el primero, y el formulario emite el POST real (#758)', async () => {
    let created = false
    mockRequestConsoleSessionJson.mockImplementation(async (url: string, init?: { method?: string; body?: unknown }) => {
      if (url === '/v1/storage/buckets?page[size]=100') {
        return created ? mockBuckets({ items: [mockBuckets().items[0]] }) : { items: [], page: { size: 0 } }
      }
      if (url === '/v1/storage/workspaces/wrk_alpha/usage') return mockUsage()
      if (url === '/v1/storage/workspaces/wrk_alpha/buckets' && init?.method === 'POST') {
        expect(init?.body).toMatchObject({ name: 'media-assets' })
        created = true
        return {
          bucket: { resourceId: 'res_bucket_1', bucketName: 'media-assets', workspaceId: 'wrk_alpha', tenantId: 'ten_alpha', region: 'eu-west-1', status: 'active' },
          record: {},
          storageCredential: null
        }
      }
      throw new Error(`Unexpected URL ${url} (${init?.method ?? 'GET'})`)
    })
    const user = userEvent.setup()

    renderPage()
    expect(await screen.findByText(/no hay buckets en el área de trabajo seleccionada/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^crear bucket$/i }))
    await user.type(screen.getByLabelText(/nombre del bucket/i), 'media-assets')
    await user.click(screen.getByRole('button', { name: /^crear$/i }))

    await waitFor(() => expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/storage/workspaces/wrk_alpha/buckets', expect.objectContaining({ method: 'POST' })))
    expect(await screen.findByRole('button', { name: 'media-assets' })).toBeInTheDocument()
  })

  it('un 409 al crear un bucket se muestra localizado y nunca el mensaje crudo del backend (#758)', async () => {
    mockRequestConsoleSessionJson.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === '/v1/storage/buckets?page[size]=100') return { items: [], page: { size: 0 } }
      if (url === '/v1/storage/workspaces/wrk_alpha/usage') return mockUsage()
      if (url === '/v1/storage/workspaces/wrk_alpha/buckets' && init?.method === 'POST') {
        const error = new Error('storage bucket quota reached for this workspace: 8/8') as Error & { status?: number }
        error.status = 409
        throw error
      }
      throw new Error(`Unexpected URL ${url} (${init?.method ?? 'GET'})`)
    })
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: /^crear bucket$/i }))
    await user.click(screen.getByRole('button', { name: /^crear$/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/conflicto/i)
    expect(alert.textContent ?? '').not.toMatch(/quota reached/i)
  })

  it('sube un objeto en el bucket seleccionado codificando el archivo en base64 (#758)', async () => {
    const putUrl = '/v1/storage/buckets/res_bucket_1/objects/media%2Fnuevo.txt'
    let uploaded = false
    mockRequestConsoleSessionJson.mockImplementation(async (url: string, init?: { method?: string; body?: unknown }) => {
      if (url === '/v1/storage/buckets?page[size]=100') return mockBuckets()
      if (url === '/v1/storage/workspaces/wrk_alpha/usage') return mockUsage()
      if (url === '/v1/storage/buckets/res_bucket_1/objects?page%5Bsize%5D=50') {
        return uploaded
          ? mockObjects({
              items: [
                ...mockObjects().items,
                {
                  resourceId: 'res_obj_new',
                  bucketResourceId: 'res_bucket_1',
                  bucketName: 'media-assets',
                  objectKey: 'media/nuevo.txt',
                  contentType: 'text/plain',
                  sizeBytes: 5,
                  timestamps: {}
                }
              ],
              page: { size: 50 }
            })
          : mockObjects()
      }
      if (url === putUrl && init?.method === 'PUT') {
        const body = init?.body as { content?: string; contentType?: string; encoding?: string }
        expect(body.encoding).toBe('base64')
        expect(body.contentType).toBe('text/plain')
        expect(body.content).toBe(Buffer.from('hello').toString('base64'))
        uploaded = true
        return { objectKey: 'media/nuevo.txt', bucketName: 'media-assets', sizeBytes: 5, contentType: 'text/plain' }
      }
      throw new Error(`Unexpected URL ${url} (${init?.method ?? 'GET'})`)
    })
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'media-assets' }))
    await user.click(await screen.findByRole('button', { name: /^subir objeto$/i }))

    const file = new File(['hello'], 'nuevo.txt', { type: 'text/plain' })
    await user.upload(screen.getByLabelText(/^archivo$/i), file)
    await user.type(screen.getByLabelText(/clave del objeto/i), 'media/nuevo.txt')
    await user.click(screen.getByRole('button', { name: /^subir$/i }))

    await waitFor(() => expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith(putUrl, expect.objectContaining({ method: 'PUT' })))
    expect(await screen.findByRole('button', { name: 'media/nuevo.txt' })).toBeInTheDocument()
  })

  it('un 409 al subir un objeto se muestra localizado y nunca el mensaje crudo del backend (#758)', async () => {
    const putUrl = '/v1/storage/buckets/res_bucket_1/objects/media%2Fnuevo.txt'
    mockRequestConsoleSessionJson.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === '/v1/storage/buckets?page[size]=100') return mockBuckets()
      if (url === '/v1/storage/workspaces/wrk_alpha/usage') return mockUsage()
      if (url === '/v1/storage/buckets/res_bucket_1/objects?page%5Bsize%5D=50') return mockObjects()
      if (url === putUrl && init?.method === 'PUT') {
        const error = new Error('storage byte quota would be exceeded for this workspace') as Error & { status?: number }
        error.status = 409
        throw error
      }
      throw new Error(`Unexpected URL ${url} (${init?.method ?? 'GET'})`)
    })
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'media-assets' }))
    await user.click(await screen.findByRole('button', { name: /^subir objeto$/i }))

    const file = new File(['hello'], 'nuevo.txt', { type: 'text/plain' })
    await user.upload(screen.getByLabelText(/^archivo$/i), file)
    await user.type(screen.getByLabelText(/clave del objeto/i), 'media/nuevo.txt')
    await user.click(screen.getByRole('button', { name: /^subir$/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/conflicto/i)
    expect(alert.textContent ?? '').not.toMatch(/byte quota/i)
  })

  it('mantiene la página utilizable cuando falla la metadatos del objeto', async () => {
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

    // [#743] localized fallback, never the raw thrown message.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/no se pudieron cargar los metadatos del objeto/i)
    expect(alert.textContent ?? '').not.toMatch(/metadata degradada/i)
    expect(screen.getByText(/almacenamiento \/ objetos/i)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Objetos' })).toBeInTheDocument()
  })

  it('muestra snippets del bucket seleccionado con placeholders cuando falta endpoint', async () => {
    queueHappyPath()
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByRole('button', { name: 'media-assets' }))

    expect(await screen.findByRole('heading', { name: 'Fragmentos de conexión' })).toBeInTheDocument()
    expect(screen.getAllByText(/<RESOURCE_HOST>/).length).toBeGreaterThan(0)
  })

  // #757: converge on the shared Card/Table/Tabs primitives — the page previously used flat
  // `rounded-xl border` panels (no bg-card) and raw <table> markup, and the object/presigned/
  // multipart switcher is semantically a tab strip.
  it('uses the shared Card/Table/Tabs primitives', async () => {
    queueHappyPath()
    const user = userEvent.setup()

    const { container } = renderPage()
    await screen.findByRole('button', { name: 'media-assets' })

    expect(container.querySelectorAll('[data-slot="card"]').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[data-slot="table"]').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'media-assets' }))
    expect(await screen.findByRole('tablist', { name: /bucket/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Objetos' })).toBeInTheDocument()
  })
})
