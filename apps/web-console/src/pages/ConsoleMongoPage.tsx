import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ConnectionSnippets } from '@/components/console/ConnectionSnippets'
import { ProvisionDatabaseWizard } from '@/components/console/wizards/ProvisionDatabaseWizard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConsoleContext } from '@/lib/console-context'
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { SnippetContext } from '@/lib/snippets/snippet-types'

type MongoDatabase = {
  databaseName: string
  stats?: {
    dataSize?: number
    storageSize?: number
    collections?: number
    indexes?: number
    avgObjSize?: number
  }
}

type MongoCollectionValidation = {
  validationLevel?: 'off' | 'moderate' | 'strict'
  validationAction?: 'error' | 'warn'
  validator?: unknown
}

type MongoCollection = {
  collectionName: string
  collectionType?: 'standard' | 'capped' | 'time-series'
  documentCount?: number
  estimatedSize?: number
  validation?: MongoCollectionValidation
}

type MongoIndexKey = {
  fieldName: string
  direction?: 1 | -1 | 'text' | 'hashed' | '2dsphere'
}

type MongoIndex = {
  indexName: string
  keys?: MongoIndexKey[]
  indexType?: 'single' | 'compound' | 'text' | 'geo' | 'hashed'
  unique?: boolean
  sparse?: boolean
  ttlSeconds?: number
  partialFilterExpression?: unknown
  rebuildState?: 'idle' | 'in_progress' | 'failed'
}

type MongoView = {
  viewName: string
  viewOn?: string
  pipeline?: unknown[]
}

type MongoDocument = {
  _id: unknown
  [key: string]: unknown
}

type MongoDocumentPage = {
  items?: MongoDocument[]
  page?: {
    after?: string | null
    size?: number
  }
}

type CollectionOf<T> = {
  items?: T[]
  page?: { total?: number }
}

type SectionState<T> = {
  data: T
  loading: boolean
  error: string | null
}

type DocumentsState = {
  data: MongoDocument[]
  loading: boolean
  error: string | null
  nextCursor: string | null
  loadingMore: boolean
}

function EMPTY_COLLECTION_STATE<T>(data: T): SectionState<T> {
  return { data, loading: false, error: null }
}

const EMPTY_DOCUMENTS_STATE: DocumentsState = {
  data: [],
  loading: false,
  error: null,
  nextCursor: null,
  loadingMore: false
}

function getApiErrorMessage(rawError: unknown, fallback: string): string {
  if (rawError && typeof rawError === 'object') {
    const maybeMessage = 'message' in rawError ? rawError.message : undefined
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage
    }

    const maybeBody = 'body' in rawError ? rawError.body : undefined
    if (maybeBody && typeof maybeBody === 'object' && 'message' in maybeBody) {
      const bodyMessage = maybeBody.message
      if (typeof bodyMessage === 'string' && bodyMessage.trim()) {
        return bodyMessage
      }
    }
  }

  return fallback
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value)
}

function formatBytes(bytes?: number): string {
  if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes < 0) {
    return '—'
  }

  if (bytes === 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent

  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`
}

function isActiveRow(selected: boolean): string {
  return selected
    ? 'bg-primary/10 ring-1 ring-primary/30'
    : 'hover:bg-accent/60 transition-colors cursor-pointer'
}

async function loadDatabases(signal?: AbortSignal): Promise<CollectionOf<MongoDatabase>> {
  return (await requestConsoleSessionJson('/v1/mongo/databases?page[size]=100', { signal })) as CollectionOf<MongoDatabase>
}

async function loadCollections(db: string, signal?: AbortSignal): Promise<CollectionOf<MongoCollection>> {
  return (await requestConsoleSessionJson(`/v1/mongo/databases/${encodePathSegment(db)}/collections?page[size]=100`, {
    signal
  })) as CollectionOf<MongoCollection>
}

async function loadCollectionDetail(db: string, col: string, signal?: AbortSignal): Promise<MongoCollection> {
  return (await requestConsoleSessionJson(`/v1/mongo/databases/${encodePathSegment(db)}/collections/${encodePathSegment(col)}`, {
    signal
  })) as MongoCollection
}

async function loadIndexes(db: string, col: string, signal?: AbortSignal): Promise<CollectionOf<MongoIndex>> {
  return (await requestConsoleSessionJson(
    `/v1/mongo/databases/${encodePathSegment(db)}/collections/${encodePathSegment(col)}/indexes?page[size]=100`,
    { signal }
  )) as CollectionOf<MongoIndex>
}

async function loadViews(db: string, signal?: AbortSignal): Promise<CollectionOf<MongoView>> {
  return (await requestConsoleSessionJson(`/v1/mongo/databases/${encodePathSegment(db)}/views?page[size]=100`, {
    signal
  })) as CollectionOf<MongoView>
}

async function loadDocuments(workspaceId: string, db: string, col: string, cursor?: string, signal?: AbortSignal): Promise<MongoDocumentPage> {
  const params = new URLSearchParams({ 'page[size]': '20' })
  if (cursor) {
    params.set('page[after]', cursor)
  }

  return (await requestConsoleSessionJson(
    `/v1/mongo/workspaces/${encodePathSegment(workspaceId)}/data/${encodePathSegment(db)}/collections/${encodePathSegment(col)}/documents?${params.toString()}`,
    { signal }
  )) as MongoDocumentPage
}

export function ConsoleMongoPage() {
  const { activeTenant, activeTenantId, activeWorkspace, activeWorkspaceId } = useConsoleContext()
  const activeWorkspaceIdRef = useRef<string | null>(activeWorkspaceId ?? null)
  const previousWorkspaceIdRef = useRef<string | null>(activeWorkspaceId ?? null)

  const [selectedDatabase, setSelectedDatabase] = useState<string | null>(null)
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null)
  const [databaseTab, setDatabaseTab] = useState<'collections' | 'views'>('collections')
  const [collectionDetailTab, setCollectionDetailTab] = useState<'indexes' | 'validation' | 'documents'>('indexes')

  const [databases, setDatabases] = useState<SectionState<MongoDatabase[]>>(() => EMPTY_COLLECTION_STATE([]))
  const [collections, setCollections] = useState<SectionState<MongoCollection[]>>(() => EMPTY_COLLECTION_STATE([]))
  const [collectionDetail, setCollectionDetail] = useState<SectionState<MongoCollection | null>>(() => EMPTY_COLLECTION_STATE(null))
  const [indexes, setIndexes] = useState<SectionState<MongoIndex[]>>(() => EMPTY_COLLECTION_STATE([]))
  const [views, setViews] = useState<SectionState<MongoView[]>>(() => EMPTY_COLLECTION_STATE([]))
  const [documents, setDocuments] = useState<DocumentsState>(EMPTY_DOCUMENTS_STATE)
  const [expandedDocumentIds, setExpandedDocumentIds] = useState<Set<number>>(() => new Set())
  const [databaseWizardOpen, setDatabaseWizardOpen] = useState(false)

  const resetCollectionDetail = useCallback(() => {
    setSelectedCollection(null)
    setCollectionDetailTab('indexes')
    setCollectionDetail(EMPTY_COLLECTION_STATE(null))
    setIndexes(EMPTY_COLLECTION_STATE([]))
    setDocuments(EMPTY_DOCUMENTS_STATE)
    setExpandedDocumentIds(new Set())
  }, [])

  const resetCollectionAndBelow = useCallback(() => {
    resetCollectionDetail()
    setCollections(EMPTY_COLLECTION_STATE([]))
    setViews(EMPTY_COLLECTION_STATE([]))
  }, [resetCollectionDetail])

  useEffect(() => {
    const controller = new AbortController()

    setSelectedDatabase(null)
    resetCollectionAndBelow()
    setDatabases(EMPTY_COLLECTION_STATE([]))

    if (!activeTenantId) {
      return () => controller.abort()
    }

    setDatabases((previous) => ({ ...previous, loading: true, error: null }))

    void loadDatabases(controller.signal)
      .then((response) => {
        if (controller.signal.aborted) {
          return
        }

        setDatabases({ data: response.items ?? [], loading: false, error: null })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }

        setDatabases({
          data: [],
          loading: false,
          error: getApiErrorMessage(error, 'No se pudieron cargar las bases de datos MongoDB.')
        })
      })

    return () => controller.abort()
  }, [activeTenantId, resetCollectionAndBelow])

  useEffect(() => {
    const previousWorkspaceId = previousWorkspaceIdRef.current
    previousWorkspaceIdRef.current = activeWorkspaceId ?? null

    if (!selectedDatabase || !activeWorkspaceId || previousWorkspaceId === activeWorkspaceId) {
      return
    }

    const controller = new AbortController()
    resetCollectionDetail()
    setCollections({ data: [], loading: true, error: null })
    setViews({ data: [], loading: true, error: null })

    void Promise.allSettled([loadCollections(selectedDatabase, controller.signal), loadViews(selectedDatabase, controller.signal)]).then((results) => {
      if (controller.signal.aborted) {
        return
      }

      const [collectionsResult, viewsResult] = results

      setCollections(
        collectionsResult.status === 'fulfilled'
          ? { data: collectionsResult.value?.items ?? [], loading: false, error: null }
          : {
              data: [],
              loading: false,
              error: getApiErrorMessage(collectionsResult.reason, 'No se pudieron cargar las colecciones.')
            }
      )

      setViews(
        viewsResult.status === 'fulfilled'
          ? { data: viewsResult.value?.items ?? [], loading: false, error: null }
          : { data: [], loading: false, error: getApiErrorMessage(viewsResult.reason, 'No se pudieron cargar las vistas.') }
      )
    })

    return () => controller.abort()
  }, [activeWorkspaceId, resetCollectionDetail, selectedDatabase])

  useEffect(() => {
    resetCollectionAndBelow()

    if (!selectedDatabase || !activeWorkspaceId) {
      return
    }

    const controller = new AbortController()
    setCollections({ data: [], loading: true, error: null })
    setViews({ data: [], loading: true, error: null })

    void Promise.allSettled([loadCollections(selectedDatabase, controller.signal), loadViews(selectedDatabase, controller.signal)]).then((results) => {
      if (controller.signal.aborted) {
        return
      }

      const [collectionsResult, viewsResult] = results

      setCollections(
        collectionsResult.status === 'fulfilled'
          ? { data: collectionsResult.value?.items ?? [], loading: false, error: null }
          : {
              data: [],
              loading: false,
              error: getApiErrorMessage(collectionsResult.reason, 'No se pudieron cargar las colecciones.')
            }
      )

      setViews(
        viewsResult.status === 'fulfilled'
          ? { data: viewsResult.value?.items ?? [], loading: false, error: null }
          : { data: [], loading: false, error: getApiErrorMessage(viewsResult.reason, 'No se pudieron cargar las vistas.') }
      )
    })

    return () => controller.abort()
  }, [activeWorkspaceId, resetCollectionAndBelow, selectedDatabase])

  useEffect(() => {
    setCollectionDetail(EMPTY_COLLECTION_STATE(null))
    setIndexes(EMPTY_COLLECTION_STATE([]))
    setDocuments(EMPTY_DOCUMENTS_STATE)
    setExpandedDocumentIds(new Set())
    setCollectionDetailTab('indexes')

    if (!selectedCollection || !selectedDatabase || !activeWorkspaceId) {
      return
    }

    const controller = new AbortController()
    setCollectionDetail({ data: null, loading: true, error: null })
    setIndexes({ data: [], loading: true, error: null })
    setDocuments({ ...EMPTY_DOCUMENTS_STATE, loading: true })

    void Promise.allSettled([
      loadCollectionDetail(selectedDatabase, selectedCollection, controller.signal),
      loadIndexes(selectedDatabase, selectedCollection, controller.signal),
      loadDocuments(activeWorkspaceId, selectedDatabase, selectedCollection, undefined, controller.signal)
    ]).then((results) => {
      if (controller.signal.aborted) {
        return
      }

      const [detailResult, indexesResult, documentsResult] = results

      setCollectionDetail(
        detailResult.status === 'fulfilled'
          ? { data: detailResult.value, loading: false, error: null }
          : {
              data: null,
              loading: false,
              error: getApiErrorMessage(detailResult.reason, 'No se pudo cargar la validación de la colección.')
            }
      )

      setIndexes(
        indexesResult.status === 'fulfilled'
          ? { data: indexesResult.value.items ?? [], loading: false, error: null }
          : { data: [], loading: false, error: getApiErrorMessage(indexesResult.reason, 'No se pudieron cargar los índices.') }
      )

      setDocuments(
        documentsResult.status === 'fulfilled'
          ? {
              data: documentsResult.value.items ?? [],
              loading: false,
              error: null,
              nextCursor: documentsResult.value.page?.after ?? null,
              loadingMore: false
            }
          : {
              data: [],
              loading: false,
              error: getApiErrorMessage(documentsResult.reason, 'No se pudieron cargar los documentos.'),
              nextCursor: null,
              loadingMore: false
            }
      )
    })

    return () => controller.abort()
  }, [activeWorkspaceId, selectedCollection, selectedDatabase])

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId ?? null
  }, [activeWorkspaceId])

  const handleLoadMoreDocuments = useCallback(async () => {
    if (
      documents.loadingMore ||
      !documents.nextCursor ||
      !selectedDatabase ||
      !selectedCollection ||
      !activeWorkspaceIdRef.current
    ) {
      return
    }

    setDocuments((previous) => ({ ...previous, loadingMore: true }))

    try {
      const response = await loadDocuments(
        activeWorkspaceIdRef.current,
        selectedDatabase,
        selectedCollection,
        documents.nextCursor
      )

      setDocuments((previous) => ({
        data: [...previous.data, ...(response.items ?? [])],
        loading: false,
        error: null,
        nextCursor: response.page?.after ?? null,
        loadingMore: false
      }))
    } catch (error) {
      setDocuments((previous) => ({
        ...previous,
        loadingMore: false,
        error: getApiErrorMessage(error, 'No se pudieron cargar más documentos.')
      }))
    }
  }, [documents.loadingMore, documents.nextCursor, selectedCollection, selectedDatabase])

  const headerDescription = useMemo(() => {
    if (!activeTenantId) {
      return 'Selecciona un tenant para explorar las bases de datos MongoDB.'
    }

    if (!activeWorkspaceId) {
      return 'Selecciona un workspace para ver colecciones, índices, validación y documentos.'
    }

    return 'Explora bases de datos, colecciones, índices, validación, documentos y vistas del dominio documental.'
  }, [activeTenantId, activeWorkspaceId])

  const selectedCollectionHasOnlyDefaultIndex = indexes.data.length === 1 && indexes.data[0]?.indexName === '_id_'

  const mongoSnippetContext = useMemo<SnippetContext | null>(() => {
    if (!selectedCollection || !selectedDatabase) {
      return null
    }

    return {
      tenantId: activeTenantId,
      tenantSlug: activeTenant?.secondary ?? null,
      workspaceId: activeWorkspaceId,
      workspaceSlug: activeWorkspace?.secondary ?? null,
      resourceName: selectedCollection,
      resourceHost: null,
      resourcePort: 27017,
      resourceExtraA: selectedDatabase,
      resourceExtraB: null,
      resourceState: null,
      externalAccessEnabled: Boolean(activeWorkspaceId)
    }
  }, [activeTenant?.secondary, activeTenantId, activeWorkspace?.secondary, activeWorkspaceId, selectedCollection, selectedDatabase])

  return (
    <section aria-label="MongoDB del tenant activo" className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline">MongoDB</Badge>
          <Badge variant="secondary">Tenant: {activeTenant?.label ?? 'Sin tenant'}</Badge>
          <Badge variant="secondary">Workspace: {activeWorkspace?.label ?? 'Sin workspace'}</Badge>
          <Button type="button" onClick={() => setDatabaseWizardOpen(true)}>Nueva base de datos</Button>
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Inventario documental del tenant activo</h1>
        <p className="mt-2 text-sm text-muted-foreground">{headerDescription}</p>
      </header>

      {databaseWizardOpen ? <ProvisionDatabaseWizard open={databaseWizardOpen} onOpenChange={setDatabaseWizardOpen} defaultEngine="mongodb" /> : null}

      <section aria-labelledby="console-mongo-breadcrumb-heading" className="rounded-3xl border border-border bg-card/50 p-4 shadow-sm">
        <h2 id="console-mongo-breadcrumb-heading" className="sr-only">Ruta de navegación MongoDB</h2>
        <nav aria-label="Navegación MongoDB" className="flex flex-wrap items-center gap-2 text-sm">
          <button className="font-medium text-foreground underline-offset-4 hover:underline" type="button" onClick={() => setSelectedDatabase(null)}>
            Bases de datos
          </button>
          {selectedDatabase ? (
            <>
              <span aria-hidden="true">›</span>
              <button className="font-medium text-foreground underline-offset-4 hover:underline" type="button" onClick={() => setSelectedCollection(null)}>
                {selectedDatabase}
              </button>
            </>
          ) : null}
          {selectedCollection ? (
            <>
              <span aria-hidden="true">›</span>
              <span className="text-muted-foreground">{selectedCollection}</span>
            </>
          ) : null}
        </nav>
      </section>

      {!activeTenantId ? <ConsoleMongoEmptyState message="Selecciona un tenant para explorar las bases de datos MongoDB." /> : null}

      {activeTenantId ? (
        <section className="rounded-3xl border border-border bg-card/50 p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Bases de datos</h2>
              <p className="text-sm text-muted-foreground">Inventario del dominio documental para el tenant activo.</p>
            </div>
            <Button type="button" variant="outline" onClick={() => setDatabases((previous) => ({ ...previous, loading: true }))}>
              Actualizar
            </Button>
          </div>

          {databases.loading ? <ConsoleSectionLoading label="Cargando bases de datos…" /> : null}
          {!databases.loading && databases.error ? (
            <ConsoleSectionError
              message={databases.error}
              actionLabel="Reintentar"
              onRetry={() => setDatabases((previous) => ({ ...previous, loading: true, error: null }))}
            />
          ) : null}
          {!databases.loading && !databases.error && databases.data.length === 0 ? (
            <ConsoleSectionEmpty message="No hay bases de datos MongoDB disponibles para este tenant." />
          ) : null}
          {!databases.loading && !databases.error && databases.data.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Base de datos</th>
                    <th className="px-3 py-2 font-medium">Tamaño datos</th>
                    <th className="px-3 py-2 font-medium">Tamaño almacenamiento</th>
                    <th className="px-3 py-2 font-medium">Colecciones</th>
                    <th className="px-3 py-2 font-medium">Índices</th>
                  </tr>
                </thead>
                <tbody>
                  {databases.data.map((database) => (
                    <tr
                      key={database.databaseName}
                      className={isActiveRow(selectedDatabase === database.databaseName)}
                      onClick={() => {
                        setSelectedDatabase(database.databaseName)
                        setDatabaseTab('collections')
                      }}
                    >
                      <td className="px-3 py-3 font-medium">{database.databaseName}</td>
                      <td className="px-3 py-3">{formatBytes(database.stats?.dataSize)}</td>
                      <td className="px-3 py-3">{formatBytes(database.stats?.storageSize)}</td>
                      <td className="px-3 py-3">{database.stats?.collections ?? '—'}</td>
                      <td className="px-3 py-3">{database.stats?.indexes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {selectedDatabase ? (
        <section className="rounded-3xl border border-border bg-card/50 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Base de datos: {selectedDatabase}</h2>
              <p className="text-sm text-muted-foreground">Colecciones y vistas disponibles en la base seleccionada.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant={databaseTab === 'collections' ? 'default' : 'outline'} onClick={() => setDatabaseTab('collections')}>
                Colecciones
              </Button>
              <Button type="button" variant={databaseTab === 'views' ? 'default' : 'outline'} onClick={() => setDatabaseTab('views')}>
                Vistas
              </Button>
            </div>
          </div>

          {databaseTab === 'collections' ? (
            !activeWorkspaceId ? (
              <ConsoleSectionEmpty message="Selecciona un workspace para ver las colecciones." />
            ) : collections.loading ? (
              <ConsoleSectionLoading label="Cargando colecciones…" />
            ) : collections.error ? (
              <ConsoleSectionError message={collections.error} actionLabel="Reintentar" onRetry={() => setCollections({ data: [], loading: true, error: null })} />
            ) : collections.data.length === 0 ? (
              <ConsoleSectionEmpty message="La base seleccionada no tiene colecciones visibles." />
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Colección</th>
                      <th className="px-3 py-2 font-medium">Tipo</th>
                      <th className="px-3 py-2 font-medium">Documentos</th>
                      <th className="px-3 py-2 font-medium">Tamaño</th>
                      <th className="px-3 py-2 font-medium">Validación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {collections.data.map((collection) => (
                      <tr
                        key={collection.collectionName}
                        className={isActiveRow(selectedCollection === collection.collectionName)}
                        onClick={() => setSelectedCollection(collection.collectionName)}
                      >
                        <td className="px-3 py-3 font-medium">{collection.collectionName}</td>
                        <td className="px-3 py-3"><CollectionTypeBadge type={collection.collectionType} /></td>
                        <td className="px-3 py-3">{collection.documentCount ?? '—'}</td>
                        <td className="px-3 py-3">{formatBytes(collection.estimatedSize)}</td>
                        <td className="px-3 py-3"><ValidationPresenceBadge present={Boolean(collection.validation?.validator)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : views.loading ? (
            <ConsoleSectionLoading label="Cargando vistas…" />
          ) : views.error ? (
            <ConsoleSectionError message={views.error} actionLabel="Reintentar" onRetry={() => setViews({ data: [], loading: true, error: null })} />
          ) : views.data.length === 0 ? (
            <ConsoleSectionEmpty message="La base seleccionada no tiene vistas MongoDB." />
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Vista</th>
                    <th className="px-3 py-2 font-medium">Fuente</th>
                    <th className="px-3 py-2 font-medium">Pipeline</th>
                  </tr>
                </thead>
                <tbody>
                  {views.data.map((view) => (
                    <tr key={view.viewName} className="align-top border-b border-border/60">
                      <td className="px-3 py-3 font-medium">{view.viewName}</td>
                      <td className="px-3 py-3">{view.viewOn ?? '—'}</td>
                      <td className="px-3 py-3">
                        <pre className="max-h-40 overflow-y-auto overflow-x-auto rounded-xl bg-muted/40 p-3 text-xs">{safeJson(view.pipeline ?? [])}</pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {selectedCollection ? (
        <>
          {mongoSnippetContext ? <ConnectionSnippets resourceType="mongo-collection" context={mongoSnippetContext} /> : null}
          <section className="rounded-3xl border border-border bg-card/50 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Colección: {selectedCollection}</h2>
              <p className="text-sm text-muted-foreground">Índices, validación y documentos de la colección seleccionada.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant={collectionDetailTab === 'indexes' ? 'default' : 'outline'} onClick={() => setCollectionDetailTab('indexes')}>
                Índices
              </Button>
              <Button type="button" variant={collectionDetailTab === 'validation' ? 'default' : 'outline'} onClick={() => setCollectionDetailTab('validation')}>
                Validación
              </Button>
              <Button type="button" variant={collectionDetailTab === 'documents' ? 'default' : 'outline'} onClick={() => setCollectionDetailTab('documents')}>
                Documentos
              </Button>
            </div>
          </div>

          {collectionDetailTab === 'indexes' ? indexes.loading ? (
            <ConsoleSectionLoading label="Cargando índices…" />
          ) : indexes.error ? (
            <ConsoleSectionError message={indexes.error} actionLabel="Reintentar" onRetry={() => setIndexes({ data: [], loading: true, error: null })} />
          ) : indexes.data.length === 0 || selectedCollectionHasOnlyDefaultIndex ? (
            <ConsoleSectionEmpty message={selectedCollectionHasOnlyDefaultIndex ? 'Solo índice _id_ — no hay índices adicionales.' : 'No hay índices visibles para esta colección.'} />
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Índice</th>
                    <th className="px-3 py-2 font-medium">Campos</th>
                    <th className="px-3 py-2 font-medium">Tipo</th>
                    <th className="px-3 py-2 font-medium">Unique</th>
                    <th className="px-3 py-2 font-medium">Sparse</th>
                    <th className="px-3 py-2 font-medium">TTL</th>
                    <th className="px-3 py-2 font-medium">Partial filter</th>
                    <th className="px-3 py-2 font-medium">Estado rebuild</th>
                  </tr>
                </thead>
                <tbody>
                  {indexes.data.map((index) => (
                    <tr key={index.indexName} className="align-top border-b border-border/60">
                      <td className="px-3 py-3 font-medium">{index.indexName}</td>
                      <td className="px-3 py-3">{(index.keys ?? []).map((key) => `${key.fieldName}: ${String(key.direction ?? '—')}`).join(', ') || '—'}</td>
                      <td className="px-3 py-3">{index.indexType ?? '—'}</td>
                      <td className="px-3 py-3">{index.unique ? 'Sí' : 'No'}</td>
                      <td className="px-3 py-3">{index.sparse ? 'Sí' : 'No'}</td>
                      <td className="px-3 py-3">{index.ttlSeconds ?? '—'}</td>
                      <td className="px-3 py-3"><pre className="max-h-32 overflow-auto rounded-xl bg-muted/40 p-3 text-xs">{index.partialFilterExpression ? safeJson(index.partialFilterExpression) : '—'}</pre></td>
                      <td className="px-3 py-3"><RebuildStateBadge state={index.rebuildState} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {collectionDetailTab === 'validation' ? collectionDetail.loading ? (
            <ConsoleSectionLoading label="Cargando validación…" />
          ) : collectionDetail.error ? (
            <ConsoleSectionError message={collectionDetail.error} actionLabel="Reintentar" onRetry={() => setCollectionDetail({ data: null, loading: true, error: null })} />
          ) : !collectionDetail.data?.validation || !collectionDetail.data.validation.validator ? (
            <ConsoleSectionEmpty message="Sin validación activa en esta colección." />
          ) : (
            <article className="mt-4 rounded-2xl border border-border bg-background/70 p-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Nivel: {collectionDetail.data.validation.validationLevel ?? '—'}</Badge>
                <Badge variant="outline">Acción: {collectionDetail.data.validation.validationAction ?? '—'}</Badge>
              </div>
              <pre className="mt-4 max-h-96 overflow-y-auto overflow-x-auto rounded-xl bg-muted/40 p-4 text-xs">{safeJson(collectionDetail.data.validation.validator)}</pre>
            </article>
          ) : null}

          {collectionDetailTab === 'documents' ? !activeWorkspaceId ? (
            <ConsoleSectionEmpty message="Selecciona un workspace para explorar documentos." />
          ) : documents.loading ? (
            <ConsoleSectionLoading label="Cargando documentos…" />
          ) : documents.error ? (
            <ConsoleSectionError message={documents.error} actionLabel="Reintentar" onRetry={() => setDocuments({ ...EMPTY_DOCUMENTS_STATE, loading: true })} />
          ) : documents.data.length === 0 ? (
            <ConsoleSectionEmpty message="Colección sin documentos." />
          ) : (
            <div className="mt-4 space-y-3">
              {documents.data.map((document, index) => {
                const expanded = expandedDocumentIds.has(index)
                return (
                  <article key={`${String(document._id)}-${index}`} className="rounded-2xl border border-border bg-background/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Documento</p>
                        <p className="font-medium">{String(document._id)}</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        aria-expanded={expanded}
                        onClick={() => {
                          setExpandedDocumentIds((previous) => {
                            const next = new Set(previous)
                            if (next.has(index)) {
                              next.delete(index)
                            } else {
                              next.add(index)
                            }
                            return next
                          })
                        }}
                      >
                        {expanded ? 'Ocultar JSON' : 'Ver JSON'}
                      </Button>
                    </div>
                    {expanded ? (
                      <pre className="mt-4 max-h-96 overflow-y-auto overflow-x-auto rounded-xl bg-muted/40 p-4 text-xs">{safeJson(document)}</pre>
                    ) : null}
                  </article>
                )
              })}

              {documents.nextCursor ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" variant="outline" onClick={() => void handleLoadMoreDocuments()} disabled={documents.loadingMore}>
                    {documents.loadingMore ? 'Cargando…' : 'Cargar más'}
                  </Button>
                  {documents.loadingMore ? <ConsoleSectionLoading label="Cargando más documentos…" /> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
        </>
      ) : null}
    </section>
  )
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return '[pipeline no serializable]'
  }
}

function ConsoleMongoEmptyState({ message }: { message: string }) {
  return <div className="rounded-3xl border border-dashed border-border bg-card/40 px-6 py-10 text-center text-sm text-muted-foreground">{message}</div>
}

function ConsoleSectionLoading({ label }: { label: string }) {
  return <p className="mt-4 text-sm text-muted-foreground">{label}</p>
}

function ConsoleSectionEmpty({ message }: { message: string }) {
  return <p className="mt-4 rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">{message}</p>
}

function ConsoleSectionError({
  message,
  actionLabel,
  onRetry
}: {
  message: string
  actionLabel: string
  onRetry: () => void
}) {
  return (
    <div role="alert" className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-foreground">
      <p>{message}</p>
      <Button className="mt-3" type="button" variant="outline" onClick={onRetry}>
        {actionLabel}
      </Button>
    </div>
  )
}

function CollectionTypeBadge({ type }: { type?: string }) {
  const className =
    type === 'capped'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
      : type === 'time-series'
        ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
        : undefined

  return (
    <Badge variant={type === 'standard' || !type ? 'secondary' : 'outline'} className={className}>
      {type ?? 'standard'}
    </Badge>
  )
}

function RebuildStateBadge({ state }: { state?: string }) {
  const className =
    state === 'in_progress'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
      : state === 'failed'
        ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
        : undefined

  return (
    <Badge variant={state === 'idle' || !state ? 'secondary' : 'outline'} className={className}>
      {state ?? '—'}
    </Badge>
  )
}

function ValidationPresenceBadge({ present }: { present: boolean }) {
  return (
    <Badge
      variant={present ? 'outline' : 'secondary'}
      className={present ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : undefined}
    >
      {present ? 'Activa' : 'Sin validación'}
    </Badge>
  )
}
