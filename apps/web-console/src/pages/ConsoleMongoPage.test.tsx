import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleMongoPage } from '@/pages/ConsoleMongoPage'

const mockRequestConsoleSessionJson = vi.fn()
const mockUseConsoleContext = vi.fn()

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: (...args: unknown[]) => mockRequestConsoleSessionJson(...args)
}))

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))

function buildContext(
  overrides: Partial<{
    activeTenant: { label: string } | null
    activeTenantId: string | null
    activeWorkspace: { label: string } | null
    activeWorkspaceId: string | null
  }> = {}
) {
  return {
    activeTenant: null,
    activeTenantId: null as string | null,
    activeWorkspace: null,
    activeWorkspaceId: null as string | null,
    ...overrides
  }
}

async function clickDatabase(name: string) {
  fireEvent.click((await screen.findAllByText(name))[0])
}

describe('ConsoleMongoPage', () => {
  beforeEach(() => {
    mockRequestConsoleSessionJson.mockReset()
    mockUseConsoleContext.mockReset()
    cleanup()
  })

  it('T01: renderiza estado vacío sin tenant activo', () => {
    mockUseConsoleContext.mockReturnValue(buildContext())

    render(<ConsoleMongoPage />)

    expect(screen.getAllByText('Selecciona un tenant para explorar las bases de datos MongoDB.').length).toBeGreaterThan(0)
  })

  it('T02: muestra estados vacíos de workspace en colecciones y documentos', async () => {
    mockUseConsoleContext.mockReturnValue(buildContext({ activeTenant: { label: 'Tenant A' }, activeTenantId: 'tenant-a' }))
    mockRequestConsoleSessionJson.mockResolvedValueOnce({ items: [{ databaseName: 'catalog' }] })

    render(<ConsoleMongoPage />)

    await clickDatabase('catalog')
    expect(await screen.findByText('Selecciona un workspace para ver las colecciones.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Documentos' })).not.toBeInTheDocument()
  })

  it('T03: muestra lista de databases con stats formateados', async () => {
    mockUseConsoleContext.mockReturnValue(buildContext({ activeTenantId: 'tenant-a' }))
    mockRequestConsoleSessionJson.mockResolvedValueOnce({
      items: [{ databaseName: 'catalog', stats: { dataSize: 2048, storageSize: 4096, collections: 4, indexes: 7 } }]
    })

    render(<ConsoleMongoPage />)

    expect(await screen.findByText('catalog')).toBeInTheDocument()
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()
    expect(screen.getByText('4.0 KB')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('T04: muestra error aislado en databases', async () => {
    mockUseConsoleContext.mockReturnValue(buildContext({ activeTenantId: 'tenant-a' }))
    mockRequestConsoleSessionJson.mockRejectedValueOnce({ message: 'Mongo down' })

    render(<ConsoleMongoPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Mongo down')
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('T05: al seleccionar database carga collections y views', async () => {
    mockUseConsoleContext.mockReturnValue(buildContext({ activeTenantId: 'tenant-a', activeWorkspaceId: 'ws-1' }))
    mockRequestConsoleSessionJson
      .mockResolvedValueOnce({ items: [{ databaseName: 'catalog' }] })
      .mockResolvedValueOnce({ items: [{ collectionName: 'orders', collectionType: 'time-series', validation: { validator: { bsonType: 'object' } } }] })
      .mockResolvedValueOnce({ items: [{ viewName: 'orders_view', viewOn: 'orders', pipeline: [] }] })

    render(<ConsoleMongoPage />)

    await clickDatabase('catalog')

    await waitFor(() => {
      expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/mongo/databases/catalog/collections?page[size]=100', expect.anything())
      expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/mongo/databases/catalog/views?page[size]=100', expect.anything())
    })

    expect(await screen.findByText('orders')).toBeInTheDocument()
  })

  it('T06: al seleccionar collection carga detail, indexes y documents', async () => {
    mockUseConsoleContext.mockReturnValue(buildContext({ activeTenantId: 'tenant-a', activeWorkspaceId: 'ws-1' }))
    mockRequestConsoleSessionJson
      .mockResolvedValueOnce({ items: [{ databaseName: 'catalog' }] })
      .mockResolvedValueOnce({ items: [{ collectionName: 'orders', validation: { validator: { bsonType: 'object' } } }] })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ collectionName: 'orders', validation: { validationLevel: 'strict', validationAction: 'error', validator: { bsonType: 'object' } } })
      .mockResolvedValueOnce({ items: [{ indexName: 'status_1', keys: [{ fieldName: 'status', direction: 1 }] }] })
      .mockResolvedValueOnce({ items: [{ _id: 'doc-1', status: 'open' }], page: { after: null, size: 20 } })

    render(<ConsoleMongoPage />)

    await clickDatabase('catalog')
    fireEvent.click(await screen.findByText('orders'))

    await waitFor(() => {
      expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/mongo/databases/catalog/collections/orders', expect.anything())
      expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/mongo/databases/catalog/collections/orders/indexes?page[size]=100', expect.anything())
      expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith(
        '/v1/mongo/workspaces/ws-1/data/catalog/collections/orders/documents?page%5Bsize%5D=20',
        expect.anything()
      )
    })
  })

  it('T07: error 403 en documents no colapsa índices ni validación', async () => {
    mockUseConsoleContext.mockReturnValue(buildContext({ activeTenantId: 'tenant-a', activeWorkspaceId: 'ws-1' }))
    mockRequestConsoleSessionJson
      .mockResolvedValueOnce({ items: [{ databaseName: 'catalog' }] })
      .mockResolvedValueOnce({ items: [{ collectionName: 'orders', validation: { validator: { bsonType: 'object' } } }] })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ collectionName: 'orders', validation: { validationLevel: 'strict', validationAction: 'warn', validator: { bsonType: 'object' } } })
      .mockResolvedValueOnce({ items: [{ indexName: 'status_1', keys: [{ fieldName: 'status', direction: 1 }] }] })
      .mockRejectedValueOnce({ message: '403 Forbidden' })

    render(<ConsoleMongoPage />)

    await clickDatabase('catalog')
    fireEvent.click(await screen.findByText('orders'))
    fireEvent.click(await screen.findByRole('button', { name: 'Documentos' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('403 Forbidden')
    fireEvent.click(screen.getByRole('button', { name: 'Índices' }))
    expect(await screen.findByText('status_1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Validación' }))
    expect(await screen.findByText(/Nivel: strict/)).toBeInTheDocument()
  })

  it('T08: toggle de documento muestra JSON completo', async () => {
    mockUseConsoleContext.mockReturnValue(buildContext({ activeTenantId: 'tenant-a', activeWorkspaceId: 'ws-1' }))
    mockRequestConsoleSessionJson
      .mockResolvedValueOnce({ items: [{ databaseName: 'catalog' }] })
      .mockResolvedValueOnce({ items: [{ collectionName: 'orders', validation: { validator: { bsonType: 'object' } } }] })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ collectionName: 'orders', validation: { validator: { bsonType: 'object' } } })
      .mockResolvedValueOnce({ items: [{ indexName: 'status_1', keys: [{ fieldName: 'status', direction: 1 }] }] })
      .mockResolvedValueOnce({ items: [{ _id: 'doc-1', status: 'open', nested: { value: 7 } }], page: { after: null, size: 20 } })

    render(<ConsoleMongoPage />)

    await clickDatabase('catalog')
    fireEvent.click(await screen.findByText('orders'))
    fireEvent.click(await screen.findByRole('button', { name: 'Documentos' }))

    const toggle = await screen.findByRole('button', { name: 'Ver JSON' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText(/"nested":/)).toBeInTheDocument()
  })

  it('T09: cargar más usa cursor correcto y acumula documentos', async () => {
    mockUseConsoleContext.mockReturnValue(buildContext({ activeTenantId: 'tenant-a', activeWorkspaceId: 'ws-1' }))
    mockRequestConsoleSessionJson
      .mockResolvedValueOnce({ items: [{ databaseName: 'catalog' }] })
      .mockResolvedValueOnce({ items: [{ collectionName: 'orders', validation: { validator: { bsonType: 'object' } } }] })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ collectionName: 'orders', validation: { validator: { bsonType: 'object' } } })
      .mockResolvedValueOnce({ items: [{ indexName: 'status_1', keys: [{ fieldName: 'status', direction: 1 }] }] })
      .mockResolvedValueOnce({ items: [{ _id: 'doc-1' }], page: { after: 'cursor-2', size: 20 } })
      .mockResolvedValueOnce({ items: [{ _id: 'doc-2' }], page: { after: null, size: 20 } })

    render(<ConsoleMongoPage />)

    await clickDatabase('catalog')
    fireEvent.click(await screen.findByText('orders'))
    fireEvent.click(await screen.findByRole('button', { name: 'Documentos' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar más' }))

    await waitFor(() => {
      expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith(
        '/v1/mongo/workspaces/ws-1/data/catalog/collections/orders/documents?page%5Bsize%5D=20&page%5Bafter%5D=cursor-2',
        expect.anything()
      )
    })

    expect(await screen.findByText('doc-2')).toBeInTheDocument()
  })

  it('T10: cambio de tenant reinicia selección y relanza databases', async () => {
    const context = buildContext({ activeTenantId: 'tenant-a', activeWorkspaceId: 'ws-1' })
    mockUseConsoleContext.mockImplementation(() => context)
    mockRequestConsoleSessionJson
      .mockResolvedValueOnce({ items: [{ databaseName: 'catalog' }] })
      .mockResolvedValueOnce({ items: [{ collectionName: 'orders' }] })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [{ databaseName: 'billing' }] })

    const view = render(<ConsoleMongoPage />)
    await clickDatabase('catalog')
    expect(await screen.findByText('orders')).toBeInTheDocument()

    context.activeTenantId = 'tenant-b'
    view.rerender(<ConsoleMongoPage />)

    expect(await screen.findByText('billing')).toBeInTheDocument()
    expect(screen.queryByText('orders')).not.toBeInTheDocument()
  })

  it('T11: cambio de workspace reinicia datos y relanza collections', async () => {
    const context = buildContext({ activeTenantId: 'tenant-a', activeWorkspaceId: 'ws-1' })
    mockUseConsoleContext.mockImplementation(() => context)
    mockRequestConsoleSessionJson
      .mockResolvedValueOnce({ items: [{ databaseName: 'catalog' }] })
      .mockResolvedValueOnce({ items: [{ collectionName: 'orders' }] })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [{ collectionName: 'events' }] })
      .mockResolvedValueOnce({ items: [{ viewName: 'events_view', pipeline: [] }] })

    const view = render(<ConsoleMongoPage />)
    await clickDatabase('catalog')
    expect(await screen.findByText('orders')).toBeInTheDocument()

    context.activeWorkspaceId = 'ws-2'
    view.rerender(<ConsoleMongoPage />)

    await waitFor(() => {
      expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/mongo/databases/catalog/collections?page[size]=100', expect.anything())
      expect(mockRequestConsoleSessionJson).toHaveBeenCalledWith('/v1/mongo/databases/catalog/views?page[size]=100', expect.anything())
    })
    expect(await screen.findByText(/colecciones visibles|Selecciona un workspace para ver las colecciones/)).toBeInTheDocument()
  })

  it('muestra snippets para la colección seleccionada con placeholder de host', async () => {
    mockUseConsoleContext.mockReturnValue(buildContext({ activeTenant: { label: 'Tenant A' }, activeTenantId: 'tenant-a', activeWorkspace: { label: 'Workspace A' }, activeWorkspaceId: 'ws-1' }))
    mockRequestConsoleSessionJson
      .mockResolvedValueOnce({ items: [{ databaseName: 'catalog' }] })
      .mockResolvedValueOnce({ items: [{ collectionName: 'orders' }] })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ collectionName: 'orders' })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] })

    render(<ConsoleMongoPage />)
    await clickDatabase('catalog')
    fireEvent.click(await screen.findByText('orders'))

    expect(await screen.findByRole('heading', { name: 'Snippets de conexión' })).toBeInTheDocument()
    expect(screen.getAllByText(/<RESOURCE_HOST>/).length).toBeGreaterThan(0)
  })
})
