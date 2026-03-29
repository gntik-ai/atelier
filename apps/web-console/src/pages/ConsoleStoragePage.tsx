import { useCallback, useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConsoleContext } from '@/lib/console-context'
import { requestConsoleSessionJson } from '@/lib/console-session'

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'
type SectionState<T> = { data: T; loading: boolean; error: string | null }
type BucketTab = 'objects' | 'presigned' | 'multipart'

type PageInfo = {
  after?: string
  nextCursor?: string
  size?: number
}

type StorageBucket = {
  resourceId: string
  tenantId: string
  workspaceId: string
  bucketName: string
  region?: string
  status?: string
  timestamps?: {
    createdAt?: string
    updatedAt?: string
    lastModifiedAt?: string
  }
  provisioning?: {
    state?: string
    failureClass?: string
    gatingMode?: string
  }
}

type StorageBucketCollection = {
  items: StorageBucket[]
  page?: PageInfo
}

type StorageObjectMetadata = {
  resourceId?: string
  bucketResourceId?: string
  bucketName?: string
  objectKey: string
  contentType?: string
  sizeBytes?: number
  etag?: string
  metadata?: Record<string, string>
  storageClass?: string
  checksumSha256?: string
  versionId?: string
  providerType?: string
  applicationId?: string
  namespace?: string
  organization?: Record<string, unknown>
  timestamps?: {
    createdAt?: string
    updatedAt?: string
    lastModifiedAt?: string
  }
}

type StorageObjectCollection = {
  items: StorageObjectMetadata[]
  page?: PageInfo
}

type StorageUsageDimensionStatus = {
  dimension?: string
  used?: number
  limit?: number | null
  remaining?: number | null
  utilizationPercent?: number | null
}

type StorageBucketUsageEntry = {
  bucketId: string
  totalBytes?: number
  objectCount?: number
  largestObjectSizeBytes?: number
}

type StorageUsageSnapshot = {
  collectionMethod?: string
  collectionStatus?: string
  snapshotAt?: string
  cacheSnapshotAt?: string | null
  dimensions?: {
    totalBytes?: StorageUsageDimensionStatus
    bucketCount?: StorageUsageDimensionStatus
    objectCount?: StorageUsageDimensionStatus
    objectSizeBytes?: StorageUsageDimensionStatus
  }
  buckets?: StorageBucketUsageEntry[]
}

const EMPTY_BUCKETS_STATE: SectionState<StorageBucket[]> = { data: [], loading: false, error: null }
const EMPTY_OBJECTS_STATE: SectionState<StorageObjectCollection | null> = { data: null, loading: false, error: null }
const EMPTY_OBJECT_META_STATE: SectionState<StorageObjectMetadata | null> = { data: null, loading: false, error: null }
const EMPTY_USAGE_STATE: SectionState<StorageUsageSnapshot | null> = { data: null, loading: false, error: null }

const STORAGE_BUCKETS_PAGE_SIZE = 100
const STORAGE_OBJECTS_PAGE_SIZE = 50
const STORAGE_PRESIGNED_READ_API_AVAILABLE = false
const STORAGE_MULTIPART_READ_API_AVAILABLE = false

function getApiErrorMessage(rawError: unknown, fallback: string): string {
  if (rawError && typeof rawError === 'object') {
    const maybeMessage = 'message' in rawError ? rawError.message : undefined
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage
    }

    const maybeBody = 'body' in rawError ? rawError.body : undefined
    if (maybeBody && typeof maybeBody === 'object' && maybeBody !== null && 'message' in maybeBody) {
      const bodyMessage = (maybeBody as { message?: unknown }).message
      if (typeof bodyMessage === 'string' && bodyMessage.trim()) {
        return bodyMessage
      }
    }
  }

  return fallback
}

function isAbortError(rawError: unknown): boolean {
  return rawError instanceof DOMException
    ? rawError.name === 'AbortError'
    : Boolean(rawError && typeof rawError === 'object' && 'name' in rawError && rawError.name === 'AbortError')
}

function formatEnumLabel(value?: string): string {
  if (!value) return '—'
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  return String(value)
}

function formatBytes(bytes?: number | null): string {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`

  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function formatRelativeDate(value?: string | null): string {
  if (!value) return '—'
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return value
  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (diffMinutes < 1) return 'hace menos de 1 minuto'
  if (diffMinutes === 1) return 'hace 1 minuto'
  if (diffMinutes < 60) return `hace ${diffMinutes} minutos`
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours === 1) return 'hace 1 hora'
  if (diffHours < 24) return `hace ${diffHours} horas`
  const diffDays = Math.round(diffHours / 24)
  return diffDays === 1 ? 'hace 1 día' : `hace ${diffDays} días`
}

function getSnapshotAgeMinutes(snapshot?: StorageUsageSnapshot | null): number | null {
  const source = snapshot?.cacheSnapshotAt ?? snapshot?.snapshotAt
  if (!source) return null
  const timestamp = new Date(source).getTime()
  if (Number.isNaN(timestamp)) return null
  return Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
}

function statusTone(value?: string): BadgeVariant {
  const normalized = value?.toLowerCase()
  if (normalized === 'active' || normalized === 'ok') return 'default'
  if (normalized === 'provisioning' || normalized === 'partial') return 'secondary'
  if (normalized === 'provider_unavailable' || normalized === 'suspended' || normalized === 'error' || normalized === 'failed') return 'destructive'
  return 'outline'
}

function KeyValueGrid({ items }: { items: Array<{ label: string; value: unknown }> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div className="rounded-lg border border-border p-3" key={item.label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 text-sm break-words">{formatValue(item.value)}</dd>
        </div>
      ))}
    </dl>
  )
}

function UnsupportedApiState({ surface }: { surface: 'presigned' | 'multipart' }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground" role="status">
      <p className="font-medium text-foreground">
        {surface === 'presigned' ? 'Presigned URLs' : 'Multipart uploads'} no disponible en la API pública actual.
      </p>
      <p className="mt-2">
        La familia pública de Storage no expone un endpoint GET de inventario para esta superficie. La consola permanece en modo read-only y no usa endpoints no documentados.
      </p>
    </div>
  )
}

export function ConsoleStoragePage() {
  const { activeTenantId, activeWorkspaceId } = useConsoleContext()
  const [buckets, setBuckets] = useState<SectionState<StorageBucket[]>>(EMPTY_BUCKETS_STATE)
  const [selectedBucketId, setSelectedBucketId] = useState<string | null>(null)
  const [bucketTab, setBucketTab] = useState<BucketTab>('objects')
  const [objects, setObjects] = useState<SectionState<StorageObjectCollection | null>>(EMPTY_OBJECTS_STATE)
  const [selectedObjectKey, setSelectedObjectKey] = useState<string | null>(null)
  const [objectMeta, setObjectMeta] = useState<SectionState<StorageObjectMetadata | null>>(EMPTY_OBJECT_META_STATE)
  const [usage, setUsage] = useState<SectionState<StorageUsageSnapshot | null>>(EMPTY_USAGE_STATE)

  const resetBucketDetailState = useCallback(() => {
    setBucketTab('objects')
    setObjects(EMPTY_OBJECTS_STATE)
    setSelectedObjectKey(null)
    setObjectMeta(EMPTY_OBJECT_META_STATE)
  }, [])

  const loadBuckets = useCallback(async (workspaceId: string, signal?: AbortSignal) => {
    setBuckets((current) => ({ ...current, loading: true, error: null }))

    try {
      const data = await requestConsoleSessionJson<StorageBucketCollection>(`/v1/storage/buckets?page[size]=${STORAGE_BUCKETS_PAGE_SIZE}`, { signal })
      const filtered = data.items.filter((bucket) => bucket.workspaceId === workspaceId)
      setBuckets({ data: filtered, loading: false, error: null })
    } catch (error) {
      if (isAbortError(error)) return
      setBuckets({ data: [], loading: false, error: getApiErrorMessage(error, 'No se pudo cargar el inventario de buckets.') })
    }
  }, [])

  const loadUsage = useCallback(async (workspaceId: string, signal?: AbortSignal) => {
    setUsage((current) => ({ ...current, loading: true, error: null }))

    try {
      const data = await requestConsoleSessionJson<StorageUsageSnapshot>(`/v1/storage/workspaces/${workspaceId}/usage`, { signal })
      setUsage({ data, loading: false, error: null })
    } catch (error) {
      if (isAbortError(error)) return
      setUsage({ data: null, loading: false, error: getApiErrorMessage(error, 'No se pudo cargar el uso del workspace.') })
    }
  }, [])

  const loadObjects = useCallback(async (bucketId: string, after: string | null, signal?: AbortSignal) => {
    setObjects((current) => ({ data: after ? current.data : null, loading: true, error: null }))

    const query = new URLSearchParams({ 'page[size]': String(STORAGE_OBJECTS_PAGE_SIZE) })
    if (after) query.set('page[after]', after)

    try {
      const data = await requestConsoleSessionJson<StorageObjectCollection>(`/v1/storage/buckets/${bucketId}/objects?${query.toString()}`, { signal })
      setObjects((current) => ({
        data: after && current.data
          ? {
              items: [...current.data.items, ...data.items],
              page: data.page
            }
          : data,
        loading: false,
        error: null
      }))
    } catch (error) {
      if (isAbortError(error)) return
      setObjects((current) => ({
        data: after ? current.data : null,
        loading: false,
        error: getApiErrorMessage(error, 'No se pudo cargar el inventario de objetos.')
      }))
    }
  }, [])

  const loadObjectMeta = useCallback(async (bucketId: string, objectKey: string, signal?: AbortSignal) => {
    setObjectMeta((current) => ({ ...current, loading: true, error: null }))

    try {
      const data = await requestConsoleSessionJson<StorageObjectMetadata>(`/v1/storage/buckets/${bucketId}/objects/${encodeURIComponent(objectKey)}/metadata`, { signal })
      setObjectMeta({ data, loading: false, error: null })
    } catch (error) {
      if (isAbortError(error)) return
      setObjectMeta({ data: null, loading: false, error: getApiErrorMessage(error, 'No se pudo cargar la metadata del objeto.') })
    }
  }, [])

  useEffect(() => {
    setBuckets(EMPTY_BUCKETS_STATE)
    setSelectedBucketId(null)
    resetBucketDetailState()
    setUsage(EMPTY_USAGE_STATE)

    if (!activeWorkspaceId) {
      return undefined
    }

    const controller = new AbortController()
    void Promise.allSettled([
      loadBuckets(activeWorkspaceId, controller.signal),
      loadUsage(activeWorkspaceId, controller.signal)
    ])
    return () => controller.abort()
  }, [activeTenantId, activeWorkspaceId, loadBuckets, loadUsage, resetBucketDetailState])

  useEffect(() => {
    if (!selectedBucketId) {
      resetBucketDetailState()
      return undefined
    }

    setSelectedObjectKey(null)
    setObjectMeta(EMPTY_OBJECT_META_STATE)

    const controller = new AbortController()
    void loadObjects(selectedBucketId, null, controller.signal)
    return () => controller.abort()
  }, [loadObjects, resetBucketDetailState, selectedBucketId])

  useEffect(() => {
    if (!selectedBucketId || !selectedObjectKey) {
      setObjectMeta(EMPTY_OBJECT_META_STATE)
      return undefined
    }

    const controller = new AbortController()
    void loadObjectMeta(selectedBucketId, selectedObjectKey, controller.signal)
    return () => controller.abort()
  }, [loadObjectMeta, selectedBucketId, selectedObjectKey])

  const selectedBucket = useMemo(
    () => buckets.data.find((bucket) => bucket.resourceId === selectedBucketId) ?? null,
    [buckets.data, selectedBucketId]
  )

  const bucketNameById = useMemo(
    () => new Map(buckets.data.map((bucket) => [bucket.resourceId, bucket.bucketName])),
    [buckets.data]
  )

  const nextObjectCursor = objects.data?.page?.nextCursor ?? objects.data?.page?.after ?? null
  const usageAgeMinutes = getSnapshotAgeMinutes(usage.data)
  const quotaPercent = usage.data?.dimensions?.totalBytes?.utilizationPercent ?? null
  const quotaLimit = usage.data?.dimensions?.totalBytes?.limit ?? null

  if (!activeTenantId) {
    return <p role="alert">Selecciona un tenant para continuar.</p>
  }

  if (!activeWorkspaceId) {
    return <p role="alert">Selecciona un workspace para ver los recursos Storage.</p>
  }

  return (
    <main className="space-y-6" data-testid="console-storage-page">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Storage / Objetos</h1>
        <p className="text-sm text-muted-foreground">Buckets, objetos, metadata y uso del workspace activo usando únicamente endpoints públicos de lectura.</p>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="space-y-6">
          <section aria-busy={buckets.loading} className="rounded-xl border border-border p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Buckets</h2>
                <p className="text-sm text-muted-foreground">Inventario visible para el workspace activo.</p>
              </div>
              <Badge variant="outline">{buckets.data.length} visibles</Badge>
            </div>

            {buckets.loading ? <p>Cargando buckets…</p> : null}
            {!buckets.loading && buckets.error ? (
              <div className="space-y-3">
                <p role="alert">{buckets.error}</p>
                <Button onClick={() => void loadBuckets(activeWorkspaceId)} type="button">Reintentar</Button>
              </div>
            ) : null}
            {!buckets.loading && !buckets.error && buckets.data.length === 0 ? <p>No hay buckets en el workspace seleccionado.</p> : null}
            {!buckets.loading && !buckets.error && buckets.data.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 pr-3">Nombre</th>
                      <th className="py-2 pr-3">Región</th>
                      <th className="py-2 pr-3">Estado</th>
                      <th className="py-2 pr-3">Provisioning</th>
                      <th className="py-2">Creado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buckets.data.map((bucket) => {
                      const selected = bucket.resourceId === selectedBucketId
                      return (
                        <tr className={`border-b border-border/60 ${selected ? 'bg-primary/10' : ''}`} key={bucket.resourceId}>
                          <td className="py-3 pr-3 align-top">
                            <button
                              className="max-w-full text-left font-medium underline-offset-4 hover:underline"
                              onClick={() => {
                                setSelectedBucketId(bucket.resourceId)
                                setBucketTab('objects')
                              }}
                              type="button"
                            >
                              {bucket.bucketName}
                            </button>
                            <div className="text-xs text-muted-foreground">{bucket.resourceId}</div>
                          </td>
                          <td className="py-3 pr-3 align-top">{formatValue(bucket.region)}</td>
                          <td className="py-3 pr-3 align-top"><Badge variant={statusTone(bucket.status)}>{formatEnumLabel(bucket.status)}</Badge></td>
                          <td className="py-3 pr-3 align-top">{bucket.provisioning?.state ? <Badge variant={statusTone(bucket.provisioning.state)}>{formatEnumLabel(bucket.provisioning.state)}</Badge> : '—'}</td>
                          <td className="py-3 align-top">{formatRelativeDate(bucket.timestamps?.createdAt)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section aria-busy={usage.loading} className="rounded-xl border border-border p-4">
            <div className="mb-4 space-y-1">
              <h2 className="text-lg font-semibold">Uso del workspace</h2>
              <p className="text-sm text-muted-foreground">Snapshot pública de volumen, recuento y distribución por bucket.</p>
            </div>

            {usage.loading ? <p>Cargando uso…</p> : null}
            {!usage.loading && usage.error ? <p role="alert">{usage.error}</p> : null}
            {!usage.loading && !usage.error && usage.data ? (
              <div className="space-y-4">
                {usage.data.collectionStatus === 'provider_unavailable' ? (
                  <p role="alert">El proveedor no expone una snapshot de uso disponible en este momento. La consola no interpreta este estado como cero.</p>
                ) : null}

                {usageAgeMinutes !== null && usageAgeMinutes > 15 ? (
                  <p role="alert">La snapshot de uso tiene {usageAgeMinutes} minutos; los valores pueden estar desactualizados.</p>
                ) : null}

                <KeyValueGrid items={[
                  { label: 'Volumen total', value: formatBytes(usage.data.dimensions?.totalBytes?.used) },
                  { label: 'Objetos totales', value: usage.data.dimensions?.objectCount?.used },
                  { label: 'Buckets', value: usage.data.dimensions?.bucketCount?.used },
                  { label: 'Método de colección', value: formatEnumLabel(usage.data.collectionMethod) },
                  { label: 'Estado de colección', value: formatEnumLabel(usage.data.collectionStatus) },
                  { label: 'Snapshot', value: formatRelativeDate(usage.data.cacheSnapshotAt ?? usage.data.snapshotAt) }
                ]} />

                {typeof quotaPercent === 'number' && quotaLimit !== null ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span>Cuota usada</span>
                      <span>{Math.round(quotaPercent)}% · {formatBytes(usage.data.dimensions?.totalBytes?.used)} / {formatBytes(quotaLimit)}</span>
                    </div>
                    <div
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={Math.max(0, Math.min(100, Math.round(quotaPercent)))}
                      className="h-3 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                    >
                      <div className={`h-full ${quotaPercent >= 90 ? 'bg-destructive' : quotaPercent >= 75 ? 'bg-yellow-500' : 'bg-primary'}`} style={{ width: `${Math.max(0, Math.min(100, quotaPercent))}%` }} />
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">La API pública no expone un límite de cuota para esta snapshot.</p>
                )}

                {usage.data.collectionStatus !== 'provider_unavailable' ? (
                  usage.data.buckets?.length ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-border text-muted-foreground">
                            <th className="py-2 pr-3">Bucket</th>
                            <th className="py-2 pr-3">Volumen</th>
                            <th className="py-2 pr-3">Objetos</th>
                            <th className="py-2">Objeto mayor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usage.data.buckets.map((bucket) => (
                            <tr className="border-b border-border/60" key={bucket.bucketId}>
                              <td className="py-2 pr-3">{bucketNameById.get(bucket.bucketId) ?? bucket.bucketId}</td>
                              <td className="py-2 pr-3">{formatBytes(bucket.totalBytes)}</td>
                              <td className="py-2 pr-3">{formatValue(bucket.objectCount)}</td>
                              <td className="py-2">{formatBytes(bucket.largestObjectSizeBytes)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p>No hay desglose por bucket disponible en la snapshot pública.</p>
                  )
                ) : null}
              </div>
            ) : null}
          </section>
        </div>

        <section className="rounded-xl border border-border p-4">
          {!selectedBucket ? (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Detalle del bucket</h2>
              <p className="text-sm text-muted-foreground">Selecciona un bucket para inspeccionar objetos, metadata y superficies auxiliares disponibles en la API pública.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{selectedBucket.bucketName}</h2>
                <Badge variant={statusTone(selectedBucket.status)}>{formatEnumLabel(selectedBucket.status)}</Badge>
                {selectedBucket.provisioning?.state ? <Badge variant={statusTone(selectedBucket.provisioning.state)}>{formatEnumLabel(selectedBucket.provisioning.state)}</Badge> : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {(['objects', 'presigned', 'multipart'] as BucketTab[]).map((tab) => (
                  <Button key={tab} onClick={() => setBucketTab(tab)} type="button" variant={bucketTab === tab ? 'default' : 'outline'}>
                    {tab === 'objects' ? 'Objetos' : tab === 'presigned' ? 'Presigned URLs' : 'Multipart'}
                  </Button>
                ))}
              </div>

              {bucketTab === 'objects' ? (
                <div className="space-y-4">
                  {objects.loading ? <p>Cargando objetos…</p> : null}
                  {!objects.loading && objects.error ? (
                    <div className="space-y-3">
                      <p role="alert">{objects.error}</p>
                      <Button onClick={() => void loadObjects(selectedBucket.resourceId, null)} type="button">Reintentar</Button>
                    </div>
                  ) : null}
                  {!objects.loading && !objects.error && objects.data && objects.data.items.length === 0 ? <p>Este bucket está vacío.</p> : null}
                  {!objects.error && objects.data && objects.data.items.length > 0 ? (
                    <>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-border text-muted-foreground">
                              <th className="py-2 pr-3">Clave</th>
                              <th className="py-2 pr-3">Tamaño</th>
                              <th className="py-2 pr-3">Content-Type</th>
                              <th className="py-2 pr-3">Última modificación</th>
                              <th className="py-2">ETag</th>
                            </tr>
                          </thead>
                          <tbody>
                            {objects.data.items.map((item) => {
                              const selected = item.objectKey === selectedObjectKey
                              return (
                                <tr className={`border-b border-border/60 ${selected ? 'bg-primary/10' : ''}`} key={item.resourceId ?? item.objectKey}>
                                  <td className="py-3 pr-3 align-top">
                                    <button
                                      className="max-w-[22rem] truncate text-left font-medium underline-offset-4 hover:underline"
                                      onClick={() => setSelectedObjectKey(item.objectKey)}
                                      title={item.objectKey}
                                      type="button"
                                    >
                                      {item.objectKey}
                                    </button>
                                  </td>
                                  <td className="py-3 pr-3 align-top">{formatBytes(item.sizeBytes)}</td>
                                  <td className="py-3 pr-3 align-top">{formatValue(item.contentType)}</td>
                                  <td className="py-3 pr-3 align-top">{formatRelativeDate(item.timestamps?.lastModifiedAt)}</td>
                                  <td className="py-3 align-top">{formatValue(item.etag)}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>

                      {nextObjectCursor ? (
                        <Button disabled={objects.loading} onClick={() => void loadObjects(selectedBucket.resourceId, nextObjectCursor)} type="button">
                          {objects.loading ? 'Cargando…' : 'Página siguiente'}
                        </Button>
                      ) : null}
                    </>
                  ) : null}

                  {selectedObjectKey ? (
                    <section className="space-y-3 rounded-xl border border-border p-4">
                      <div>
                        <h3 className="font-semibold">Metadata del objeto</h3>
                        <p className="text-sm text-muted-foreground">Detalle read-only obtenido desde el endpoint público de metadata.</p>
                      </div>

                      {objectMeta.loading ? <p>Cargando metadata…</p> : null}
                      {!objectMeta.loading && objectMeta.error ? <p role="alert">{objectMeta.error}</p> : null}
                      {!objectMeta.loading && !objectMeta.error && objectMeta.data ? (
                        <div className="space-y-4">
                          <KeyValueGrid items={[
                            { label: 'Clave', value: objectMeta.data.objectKey },
                            { label: 'Bucket', value: objectMeta.data.bucketName },
                            { label: 'Tamaño', value: formatBytes(objectMeta.data.sizeBytes) },
                            { label: 'Content-Type', value: objectMeta.data.contentType },
                            { label: 'Storage class', value: objectMeta.data.storageClass },
                            { label: 'ETag', value: objectMeta.data.etag },
                            { label: 'Checksum SHA-256', value: objectMeta.data.checksumSha256 },
                            { label: 'Version ID', value: objectMeta.data.versionId },
                            { label: 'Provider', value: objectMeta.data.providerType },
                            { label: 'Aplicación', value: objectMeta.data.applicationId },
                            { label: 'Namespace', value: objectMeta.data.namespace },
                            { label: 'Creado', value: objectMeta.data.timestamps?.createdAt },
                            { label: 'Actualizado', value: objectMeta.data.timestamps?.updatedAt },
                            { label: 'Última modificación', value: objectMeta.data.timestamps?.lastModifiedAt }
                          ]} />

                          <section className="space-y-3">
                            <h4 className="font-medium">Metadata personalizada</h4>
                            {objectMeta.data.metadata && Object.keys(objectMeta.data.metadata).length > 0 ? (
                              <div className="overflow-x-auto">
                                <table className="min-w-full text-left text-sm">
                                  <thead>
                                    <tr className="border-b border-border text-muted-foreground">
                                      <th className="py-2 pr-3">Clave</th>
                                      <th className="py-2">Valor</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {Object.entries(objectMeta.data.metadata).map(([key, value]) => (
                                      <tr className="border-b border-border/60" key={key}>
                                        <td className="py-2 pr-3">{key}</td>
                                        <td className="py-2">{value}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p>Este objeto no expone metadata personalizada.</p>
                            )}
                          </section>
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                </div>
              ) : null}

              {bucketTab === 'presigned'
                ? STORAGE_PRESIGNED_READ_API_AVAILABLE
                  ? <p>Inventario público de presigned URLs pendiente de implementación.</p>
                  : <UnsupportedApiState surface="presigned" />
                : null}
              {bucketTab === 'multipart'
                ? STORAGE_MULTIPART_READ_API_AVAILABLE
                  ? <p>Inventario público de sesiones multipart pendiente de implementación.</p>
                  : <UnsupportedApiState surface="multipart" />
                : null}
            </div>
          )}
        </section>
      </section>
    </main>
  )
}
