import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { WorkspaceRequiredState } from '@/components/console/WorkspaceRequiredState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConsoleContext } from '@/lib/console-context'
import { describeConsoleError, getConsoleErrorStatus } from '@/lib/console-errors'
import { publicApiFetch } from '@/lib/http'
import { readConsoleShellSession, requestConsoleSessionJson } from '@/lib/console-session'

type KafkaNamingPolicy = {
  topicPrefix?: string
  physicalTopicPattern?: string
  topicNameGovernance?: string
  maxTopicNameLength?: number
  consumerGroupPrefix?: string
  serviceAccountPrincipalPrefix?: string
  userProvidedPhysicalNamesAllowed?: boolean
}

type KafkaTenantIsolation = {
  mode?: string
  topicPrefix?: string
  consumerGroupPrefix?: string
  aclPatternType?: string
  workspacePrincipalPrefix?: string
  workspacePrincipalCount?: number
  crossTenantAccessPrevented?: boolean
}

type KafkaQuotaStatus = {
  metricKey?: string
  limit?: number
  used?: number
  remaining?: number
  enforcementMode?: string
  maxPartitionsPerTopic?: number
  maxPublishesPerSecond?: number
  maxConcurrentSubscriptions?: number
  maxReplayBatchSize?: number
  maxNotificationQueueDepth?: number
  visibleInConsole?: boolean
}

type KafkaTopicInventoryItem = {
  resourceId: string
  topicName: string
  physicalTopicName?: string
  status?: string
  provisioning?: { state?: string; failureClass?: string; gatingMode?: string }
  cleanupPolicy?: string
  partitionCount?: number
  retentionHours?: number
  quotaStatus?: KafkaQuotaStatus
  operationalMetadata?: { bridgeCount?: number; bridgeIds?: string[] }
}

type KafkaInventory = {
  workspaceId: string
  tenantId: string
  brokerMode?: string
  isolationMode?: string
  items: KafkaTopicInventoryItem[]
  counts?: { total?: number; active?: number; provisioning?: number; degraded?: number; topics?: number; aclBindings?: number; serviceAccounts?: number }
  namingPolicy?: KafkaNamingPolicy
  quotaStatus?: KafkaQuotaStatus
  tenantIsolation?: KafkaTenantIsolation
  observedAt?: string
  snapshotId?: string
  auditCoverage?: { mode?: string; retentionDays?: number }
  bridgeIds?: string[]
}

type KafkaTopicDetail = {
  resourceId: string
  topicName: string
  physicalTopicName?: string
  channelPrefix?: string
  partitionCount?: number
  replicationFactor?: number
  retentionHours?: number
  cleanupPolicy?: string
  deliverySemantics?: string
  partitionStrategy?: string
  partitionSelectionPolicy?: string
  replayWindowHours?: number
  maxPublishesPerSecond?: number
  maxConcurrentSubscriptions?: number
  status?: string
  auditMode?: string
  allowedTransports?: string[]
  provisioning?: { state?: string; failureClass?: string }
  quotaStatus?: KafkaQuotaStatus
  tenantIsolation?: KafkaTenantIsolation
  namingPolicy?: KafkaNamingPolicy
  payloadPolicy?: { maxPayloadBytes?: number; compressionHint?: string; schemaValidation?: string }
  replayPolicy?: { enabled?: boolean; storageBackend?: string; maxReplayWindowHours?: number }
  notificationPolicy?: { queuesEnabled?: boolean; maxQueueDepth?: number; retentionHours?: number }
  operationalMetadata?: { bridgeCount?: number; functionTriggerCount?: number; sampledAt?: string; visibleFields?: string[] }
  timestamps?: { createdAt?: string; updatedAt?: string }
  tenantId?: string
  workspaceId?: string
}

type KafkaAclBinding = {
  principal: string
  serviceAccountId?: string
  resourceType?: string
  resourceName?: string
  patternType?: string
  operations?: string[]
  permission?: string
  consumerGroupPrefix?: string
  workspaceScoped?: boolean
}

type KafkaAccessPolicy = {
  resourceId: string
  topicName: string
  physicalTopicName?: string
  aclBindings: KafkaAclBinding[]
  auditMode?: string
  providerCompatibility?: { provider?: string; nativeAclSupport?: boolean; managedPrincipals?: boolean }
  provisioning?: { state?: string }
  quotaStatus?: KafkaQuotaStatus
  tenantIsolation?: KafkaTenantIsolation
}

type KafkaPartitionMeta = Record<string, {
  lag?: number
  logStartOffset?: number
  logEndOffset?: number
  replicaCount?: number
  leader?: number
  inSync?: boolean
}>

type KafkaMetadata = {
  resourceId: string
  sampledAt?: string
  lag?: { consumerGroupId?: string; totalLag?: number; maxPartitionLag?: number; isActive?: boolean; available?: boolean; maxMessagesBehind?: number; p95Ms?: number; observedAt?: string }
  retention?: { retentionHours?: number; retentionBytes?: number; effectivePolicy?: string; available?: boolean; hours?: number; retentionMs?: number; replayWindowHours?: number }
  compaction?: { enabled?: boolean; lastCompactionTimestamp?: string; compactionLag?: number; available?: boolean; cleanupPolicy?: string; reason?: string }
  partitionMetadata?: KafkaPartitionMeta | { available?: boolean; partitionCount?: number; partitionKeysExposed?: boolean; reason?: string }
  technicalLimitations?: Array<{ code?: string; description?: string; affectedField?: string } | string>
}

type KafkaBridgeSource = {
  sourceType?: string
  sourceRef?: string
  workspaceId?: string
}

type KafkaBridge = {
  bridgeId: string
  topicRef: string
  status: string
  source?: KafkaBridgeSource
  delivery?: { mode?: string; guarantees?: string; retryPolicy?: string }
  audit?: { enabled?: boolean; retentionDays?: number; maskFields?: string[]; mode?: string }
  timestamps?: { createdAt?: string; updatedAt?: string }
}

type KafkaPublishRequest = {
  payload: unknown
  eventType?: string
  key?: string
  contentType?: string
}

type KafkaPublishAccepted = {
  publicationId: string
  status: string
  acceptedAt?: string
  topicName?: string
  acceptedPartition?: number
  key?: string
  payloadSizeBytes?: number
  deliverySemantics?: string
  auditRecordId?: string
  correlationId?: string
}

type KafkaStreamEvent = {
  receivedAt: string
  raw: string
  key?: string
  eventType?: string
  payload?: unknown
}

type CollectionOf<T> = { items: T[]; page?: { total?: number } }
type SectionState<T> = { data: T; loading: boolean; error: string | null }
type TopicTab = 'detail' | 'access' | 'metadata' | 'publish' | 'stream'

const EMPTY_INVENTORY_STATE: SectionState<KafkaInventory | null> = { data: null, loading: false, error: null }
const EMPTY_BRIDGES_STATE: SectionState<KafkaBridge[]> = { data: [], loading: false, error: null }
const EMPTY_TOPIC_DETAIL_STATE: SectionState<KafkaTopicDetail | null> = { data: null, loading: false, error: null }
const EMPTY_TOPIC_ACCESS_STATE: SectionState<KafkaAccessPolicy | null> = { data: null, loading: false, error: null }
const EMPTY_TOPIC_METADATA_STATE: SectionState<KafkaMetadata | null> = { data: null, loading: false, error: null }
const EMPTY_PUBLISH_RESULT_STATE: SectionState<KafkaPublishAccepted | null> = { data: null, loading: false, error: null }

function isAbortError(rawError: unknown): boolean {
  return rawError instanceof DOMException
    ? rawError.name === 'AbortError'
    : Boolean(rawError && typeof rawError === 'object' && 'name' in rawError && rawError.name === 'AbortError')
}

function formatEnumLabel(value?: string): string {
  if (!value) return '—'
  const normalized = value.toLowerCase()
  const labels: Record<string, string> = {
    active: 'Activo',
    at_least_once: 'Al menos una vez',
    at_most_once: 'Como máximo una vez',
    available: 'Disponible',
    compact: 'Compactar',
    compact_and_delete: 'Compactar y eliminar',
    delete: 'Eliminar',
    degraded: 'Degradado',
    disabled: 'Deshabilitado',
    enabled: 'Habilitado',
    exactly_once: 'Exactamente una vez',
    failed: 'Fallido',
    hard: 'Estricto',
    healthy: 'Saludable',
    none: 'Ninguno',
    planned: 'Planificado',
    prefix: 'Prefijo',
    provider_managed: 'Gestionado por proveedor',
    provisioning: 'Aprovisionamiento',
    shared_cluster: 'Cluster compartido',
    soft: 'Suave',
    suspended: 'Suspendido'
  }
  if (labels[normalized]) return labels[normalized]
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function topicTabLabel(tab: TopicTab): string {
  switch (tab) {
    case 'detail':
      return 'Detalle'
    case 'access':
      return 'Acceso'
    case 'metadata':
      return 'Metadatos'
    case 'publish':
      return 'Publicar'
    case 'stream':
      return 'Flujo'
  }
}

function formatRelativeDate(value?: string): string {
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

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (typeof value === 'string' && /^[A-Za-z0-9_.-]+$/.test(value)) return formatEnumLabel(value)
  return String(value)
}

function formatCleanupPolicy(value?: string): string {
  switch (value) {
    case 'delete':
      return 'Eliminar'
    case 'compact':
      return 'Compactar'
    case 'compact_and_delete':
    case 'compact,delete':
      return 'Compactar+Eliminar'
    default:
      return formatEnumLabel(value)
  }
}

function formatDeliverySemantics(value?: string): string {
  switch (value) {
    case 'at_least_once':
      return 'Al menos una vez'
    case 'at_most_once':
      return 'Como máximo una vez'
    case 'exactly_once':
      return 'Exactamente una vez'
    case 'exactly_once_candidate':
      return 'Exactamente una vez (candidato)'
    default:
      return formatEnumLabel(value)
  }
}

function quotaLabel(quota?: KafkaQuotaStatus): string | null {
  if (!quota) return null
  if (quota.remaining === 0) return 'Cuota agotada'
  if (quota.enforcementMode && quota.enforcementMode !== 'none') return 'Aplicación de límites activa'
  return null
}

function quotaHighlighted(quota?: KafkaQuotaStatus): boolean {
  return Boolean(quota && (quota.remaining === 0 || (quota.enforcementMode && quota.enforcementMode !== 'none')))
}

function statusTone(value?: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const normalized = value?.toLowerCase()
  if (normalized === 'active' || normalized === 'healthy') return 'default'
  if (normalized === 'provisioning' || normalized === 'planned') return 'secondary'
  if (normalized === 'degraded' || normalized === 'failed' || normalized === 'error' || normalized === 'paused' || normalized === 'suspended') {
    return 'destructive'
  }
  return 'outline'
}

function lagTone(totalLag?: number): { label: string; tone: 'default' | 'secondary' | 'destructive' | 'outline' } {
  if (typeof totalLag !== 'number') return { label: 'No disponible', tone: 'outline' }
  if (totalLag < 1000) return { label: 'Bajo', tone: 'default' }
  if (totalLag <= 10_000) return { label: 'Medio', tone: 'secondary' }
  return { label: 'Alto', tone: 'destructive' }
}

function parseSseData(raw: string): Pick<KafkaStreamEvent, 'key' | 'eventType' | 'payload'> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      key: typeof parsed.key === 'string' ? parsed.key : undefined,
      eventType: typeof parsed.eventType === 'string' ? parsed.eventType : typeof parsed.type === 'string' ? parsed.type : undefined,
      payload: 'payload' in parsed ? parsed.payload : parsed
    }
  } catch {
    return { payload: raw }
  }
}

function KeyValueGrid({ items }: { items: Array<{ label: string; value: unknown }> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div className="rounded-lg border border-border p-3" key={item.label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 text-sm">{formatValue(item.value)}</dd>
        </div>
      ))}
    </dl>
  )
}

export function ConsoleKafkaPage() {
  const { activeTenantId, activeWorkspaceId } = useConsoleContext()
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null)
  const [topicDetailTab, setTopicDetailTab] = useState<TopicTab>('detail')
  const [inventory, setInventory] = useState<SectionState<KafkaInventory | null>>(EMPTY_INVENTORY_STATE)
  const [bridges, setBridges] = useState<SectionState<KafkaBridge[]>>(EMPTY_BRIDGES_STATE)
  const [topicDetail, setTopicDetail] = useState<SectionState<KafkaTopicDetail | null>>(EMPTY_TOPIC_DETAIL_STATE)
  const [topicAccess, setTopicAccess] = useState<SectionState<KafkaAccessPolicy | null>>(EMPTY_TOPIC_ACCESS_STATE)
  const [topicMetadata, setTopicMetadata] = useState<SectionState<KafkaMetadata | null>>(EMPTY_TOPIC_METADATA_STATE)
  const [publishForm, setPublishForm] = useState({ payload: '', eventType: '', key: '', contentType: 'application/json' })
  const [publishResult, setPublishResult] = useState<SectionState<KafkaPublishAccepted | null>>(EMPTY_PUBLISH_RESULT_STATE)
  // #743: the quota guidance below the publish error used to sniff the raw backend message for
  // "quota"/"429" substrings — impossible once the message is localized. Track the rate-limit
  // condition from the actual HTTP status instead.
  const [publishRateLimited, setPublishRateLimited] = useState(false)
  const [streamActive, setStreamActive] = useState(false)
  const [streamEvents, setStreamEvents] = useState<KafkaStreamEvent[]>([])
  const [streamError, setStreamError] = useState<string | null>(null)
  const [showHighVolumeWarning, setShowHighVolumeWarning] = useState(false)
  const streamAbortRef = useRef<AbortController | null>(null)
  const streamEventTimesRef = useRef<number[]>([])

  const stopStream = useCallback(() => {
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    setStreamActive(false)
  }, [])

  const resetTopicState = useCallback(() => {
    setTopicDetail(EMPTY_TOPIC_DETAIL_STATE)
    setTopicAccess(EMPTY_TOPIC_ACCESS_STATE)
    setTopicMetadata(EMPTY_TOPIC_METADATA_STATE)
    setPublishResult(EMPTY_PUBLISH_RESULT_STATE)
    setPublishRateLimited(false)
    setStreamEvents([])
    setStreamError(null)
    setStreamActive(false)
    setShowHighVolumeWarning(false)
    streamEventTimesRef.current = []
  }, [])

  const loadInventory = useCallback(async (workspaceId: string, signal?: AbortSignal) => {
    setInventory((current) => ({ ...current, loading: true, error: null }))

    try {
      const data = await requestConsoleSessionJson<KafkaInventory>(`/v1/events/workspaces/${workspaceId}/inventory?page[size]=100`, { signal })
      setInventory({ data, loading: false, error: null })
    } catch (error) {
      if (isAbortError(error)) return
      setInventory({ data: null, loading: false, error: describeConsoleError(error, 'No se pudo cargar el inventario de Kafka.') })
    }
  }, [])

  const loadTopicDetail = useCallback(async (resourceId: string, signal?: AbortSignal) => {
    setTopicDetail((current) => ({ ...current, loading: true, error: null }))
    try {
      const data = await requestConsoleSessionJson<KafkaTopicDetail>(`/v1/events/topics/${resourceId}`, { signal })
      setTopicDetail({ data, loading: false, error: null })
    } catch (error) {
      if (isAbortError(error)) return
      setTopicDetail({ data: null, loading: false, error: describeConsoleError(error, 'No se pudo cargar el detalle del tópico.') })
    }
  }, [])

  const loadTopicAccess = useCallback(async (resourceId: string, signal?: AbortSignal) => {
    setTopicAccess((current) => ({ ...current, loading: true, error: null }))
    try {
      const data = await requestConsoleSessionJson<KafkaAccessPolicy>(`/v1/events/topics/${resourceId}/access`, { signal })
      setTopicAccess({ data, loading: false, error: null })
    } catch (error) {
      if (isAbortError(error)) return
      setTopicAccess({ data: null, loading: false, error: describeConsoleError(error, 'No se pudo cargar la política de acceso del tópico.') })
    }
  }, [])

  const loadTopicMetadata = useCallback(async (resourceId: string, signal?: AbortSignal) => {
    setTopicMetadata((current) => ({ ...current, loading: true, error: null }))
    try {
      const rawData = await requestConsoleSessionJson<KafkaMetadata & {
        lag?: KafkaMetadata['lag'] & { maxMessagesBehind?: number }
        retention?: KafkaMetadata['retention'] & { hours?: number; retentionMs?: number; replayWindowHours?: number }
      }>(`/v1/events/topics/${resourceId}/metadata`, { signal })
      const data: KafkaMetadata = {
        ...rawData,
        lag: rawData.lag
          ? {
              ...rawData.lag,
              totalLag: rawData.lag.totalLag ?? rawData.lag.maxMessagesBehind,
              maxPartitionLag: rawData.lag.maxPartitionLag ?? rawData.lag.maxMessagesBehind
            }
          : undefined,
        retention: rawData.retention
          ? {
              ...rawData.retention,
              retentionHours: rawData.retention.retentionHours ?? rawData.retention.hours,
              retentionBytes: rawData.retention.retentionBytes ?? rawData.retention.retentionMs,
              effectivePolicy: rawData.retention.effectivePolicy ?? 'provider_managed'
            }
          : undefined
      }
      setTopicMetadata({ data, loading: false, error: null })
    } catch (error) {
      if (isAbortError(error)) return
      setTopicMetadata({ data: null, loading: false, error: describeConsoleError(error, 'No se pudieron cargar los metadatos operacionales del tópico.') })
    }
  }, [])

  const handlePublish = useCallback(async () => {
    if (!selectedTopicId) return

    setPublishResult({ data: null, loading: true, error: null })

    let payload: unknown = publishForm.payload
    try {
      payload = publishForm.payload.trim() ? JSON.parse(publishForm.payload) : publishForm.payload
    } catch {
      payload = publishForm.payload
    }

    const body: KafkaPublishRequest = {
      payload,
      eventType: publishForm.eventType || undefined,
      key: publishForm.key || undefined,
      contentType: publishForm.contentType || undefined
    }

    try {
      const data = await requestConsoleSessionJson<KafkaPublishAccepted>(`/v1/events/topics/${selectedTopicId}/publish`, {
        method: 'POST',
        body: body as never
      })
      setPublishResult({ data, loading: false, error: null })
      setPublishRateLimited(false)
    } catch (error) {
      const message = describeConsoleError(error, 'No se pudo publicar el evento de prueba.')
      setPublishResult({ data: null, loading: false, error: message })
      setPublishRateLimited(getConsoleErrorStatus(error) === 429)
    }
  }, [publishForm, selectedTopicId])

  const startStream = useCallback(async (resourceId: string) => {
    stopStream()
    const token = readConsoleShellSession()?.tokenSet?.accessToken?.trim()
    if (!token) {
      setStreamError('Sesión no disponible. Vuelve a iniciar sesión.')
      return
    }

    const controller = new AbortController()
    streamAbortRef.current = controller
    setStreamEvents([])
    setStreamError(null)
    setStreamActive(true)
    setShowHighVolumeWarning(false)
    streamEventTimesRef.current = []

    try {
      const response = await publicApiFetch(`/v1/events/topics/${resourceId}/stream`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      })

      if (!response.ok) {
        // #743: the SSE stream endpoint fails via a raw `fetch`, not `requestConsoleSessionJson`
        // (no ApiError normalization), so the backend's `message` used to be echoed verbatim.
        // Map through the shared, localized helper instead — the response status is the only
        // signal worth trusting here.
        setStreamError(describeConsoleError({ status: response.status }, 'No se pudo iniciar el flujo.'))
        setStreamActive(false)
        return
      }

      if (!response.body) {
        setStreamError('El flujo no devolvió contenido legible.')
        setStreamActive(false)
        return
      }

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const now = Date.now()
        const lines = value.split('\n')
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const raw = line.slice(5).trim()
          const parsed = parseSseData(raw)
          streamEventTimesRef.current = [...streamEventTimesRef.current.filter((item) => now - item < 1000), now]
          setShowHighVolumeWarning(streamEventTimesRef.current.length > 10)
          setStreamEvents((previous) => [{ receivedAt: new Date().toISOString(), raw, ...parsed }, ...previous].slice(0, 100))
        }
      }

      setStreamActive(false)
      streamAbortRef.current = null
    } catch (error) {
      if (isAbortError(error)) {
        setStreamActive(false)
        streamAbortRef.current = null
        return
      }
      setStreamError(describeConsoleError(error, 'La conexión de flujo falló.'))
      setStreamActive(false)
      streamAbortRef.current = null
    }
  }, [stopStream])

  useEffect(() => {
    stopStream()
    setInventory(EMPTY_INVENTORY_STATE)
    setBridges(EMPTY_BRIDGES_STATE)
    resetTopicState()
    setSelectedTopicId(null)
    setTopicDetailTab('detail')

    if (!activeWorkspaceId) {
      return undefined
    }

    const controller = new AbortController()
    void loadInventory(activeWorkspaceId, controller.signal)
    return () => controller.abort()
  }, [activeTenantId, activeWorkspaceId, loadInventory, resetTopicState, stopStream])

  useEffect(() => {
    if (!selectedTopicId) {
      resetTopicState()
      return undefined
    }

    stopStream()
    setPublishResult(EMPTY_PUBLISH_RESULT_STATE)
    setPublishRateLimited(false)
    setStreamEvents([])
    setStreamError(null)
    setShowHighVolumeWarning(false)

    const controller = new AbortController()
    void Promise.allSettled([
      loadTopicDetail(selectedTopicId, controller.signal),
      loadTopicAccess(selectedTopicId, controller.signal),
      loadTopicMetadata(selectedTopicId, controller.signal)
    ])
    return () => {
      stopStream()
      controller.abort()
    }
  }, [loadTopicAccess, loadTopicDetail, loadTopicMetadata, resetTopicState, selectedTopicId, stopStream])

  useEffect(() => {
    if (!inventory.data || !activeWorkspaceId) {
      setBridges(EMPTY_BRIDGES_STATE)
      return undefined
    }

    const explicitBridgeIds = new Set<string>()
    inventory.data.bridgeIds?.forEach((bridgeId) => explicitBridgeIds.add(bridgeId))
    inventory.data.items.forEach((item) => item.operationalMetadata?.bridgeIds?.forEach((bridgeId) => explicitBridgeIds.add(bridgeId)))

    if (explicitBridgeIds.size === 0) {
      setBridges({ data: [], loading: false, error: null })
      return undefined
    }

    const controller = new AbortController()
    setBridges({ data: [], loading: true, error: null })

    void (async () => {
      const loaded: KafkaBridge[] = []
      try {
        for (const bridgeId of explicitBridgeIds) {
          const bridge = await requestConsoleSessionJson<KafkaBridge>(`/v1/events/workspaces/${activeWorkspaceId}/bridges/${bridgeId}`, {
            signal: controller.signal
          })
          loaded.push(bridge)
        }
        setBridges({ data: loaded, loading: false, error: null })
      } catch (error) {
        if (isAbortError(error)) return
        setBridges({ data: [], loading: false, error: describeConsoleError(error, 'No se pudo cargar la lista de puentes.') })
      }
    })()

    return () => controller.abort()
  }, [activeWorkspaceId, inventory.data])

  const selectedTopic = useMemo(
    () => inventory.data?.items.find((item) => item.resourceId === selectedTopicId) ?? null,
    [inventory.data, selectedTopicId]
  )

  const bridgesUnavailableBecauseIdsMissing = useMemo(() => {
    if (!inventory.data) return false
    const hasBridgeCount = inventory.data.items.some((item) => (item.operationalMetadata?.bridgeCount ?? 0) > 0)
    const hasBridgeIds = Boolean(inventory.data.bridgeIds?.length || inventory.data.items.some((item) => item.operationalMetadata?.bridgeIds?.length))
    return hasBridgeCount && !hasBridgeIds
  }, [inventory.data])

  if (!activeTenantId) {
    return <p role="alert">Selecciona una organización para continuar.</p>
  }

  if (!activeWorkspaceId) {
    return <WorkspaceRequiredState description="Selecciona un área de trabajo para ver los recursos Kafka." />
  }

  const lagSummary = lagTone(topicMetadata.data?.lag?.totalLag)

  return (
    <section className="space-y-6" data-testid="console-kafka-page">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Kafka / Eventos</h1>
        <p className="text-sm text-muted-foreground">Tópicos, ACLs, metadatos operacionales, puentes y herramientas de publicación/flujo para el área de trabajo activa.</p>
      </section>

      <section className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
        <div className="min-w-0 space-y-6">
          <section className="min-w-0 rounded-xl border border-border p-4">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Tópicos Kafka</h2>
                <p className="text-sm text-muted-foreground">
                  Broker {formatEnumLabel(inventory.data?.brokerMode)} · aislamiento {formatEnumLabel(inventory.data?.isolationMode)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs sm:justify-end">
                <Badge variant="outline">Total {inventory.data?.counts?.total ?? inventory.data?.counts?.topics ?? inventory.data?.items.length ?? 0}</Badge>
                <Badge variant="outline">Activos {inventory.data?.counts?.active ?? 0}</Badge>
                <Badge variant="outline">Aprovisionamiento {inventory.data?.counts?.provisioning ?? 0}</Badge>
                <Badge variant="outline">Degradados {inventory.data?.counts?.degraded ?? 0}</Badge>
              </div>
            </div>

            {inventory.loading ? <p>Cargando inventario…</p> : null}
            {!inventory.loading && inventory.error ? (
              <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
                <p className="text-sm text-destructive">{inventory.error}</p>
                <Button onClick={() => void loadInventory(activeWorkspaceId)} type="button" variant="outline" size="sm" className="mt-3">Reintentar</Button>
              </div>
            ) : null}
            {!inventory.loading && !inventory.error && inventory.data && inventory.data.items.length === 0 ? <p>No hay tópicos en esta área de trabajo.</p> : null}
            {!inventory.loading && !inventory.error && inventory.data && inventory.data.items.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 pr-3">Nombre</th>
                      <th className="py-2 pr-3">Estado</th>
                      <th className="py-2 pr-3">Política</th>
                      <th className="py-2 pr-3">Particiones</th>
                      <th className="py-2 pr-3">Retención (h)</th>
                      <th className="py-2">Cuota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.data.items.map((item) => {
                      const selected = item.resourceId === selectedTopicId
                      const quota = quotaLabel(item.quotaStatus)
                      return (
                        <tr
                          className={`cursor-pointer border-b border-border/60 ${selected ? 'bg-primary/10' : ''}`}
                          key={item.resourceId}
                          onClick={() => {
                            setSelectedTopicId(item.resourceId)
                            setTopicDetailTab('detail')
                          }}
                        >
                          <td className="py-3 pr-3">
                            <div className="font-medium">{item.topicName}</div>
                            <div className="text-xs text-muted-foreground">{item.physicalTopicName || item.resourceId}</div>
                          </td>
                          <td className="py-3 pr-3"><Badge variant={statusTone(item.provisioning?.state ?? item.status)}>{formatEnumLabel(item.provisioning?.state ?? item.status)}</Badge></td>
                          <td className="py-3 pr-3">{formatCleanupPolicy(item.cleanupPolicy)}</td>
                          <td className="py-3 pr-3">{formatValue(item.partitionCount)}</td>
                          <td className="py-3 pr-3">{formatValue(item.retentionHours)}</td>
                          <td className="py-3">{quota ? <Badge variant="secondary">{quota}</Badge> : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="min-w-0 rounded-xl border border-border p-4">
            <h2 className="text-lg font-semibold">Puentes</h2>
            {bridges.loading ? <p className="mt-4">Cargando puentes…</p> : null}
            {!bridges.loading && bridges.error ? <p className="mt-4" role="alert">{bridges.error}</p> : null}
            {!bridges.loading && !bridges.error && bridgesUnavailableBecauseIdsMissing ? (
              <p className="mt-4">La lista de puentes requiere IDs expuestos por el inventario.</p>
            ) : null}
            {!bridges.loading && !bridges.error && !bridgesUnavailableBecauseIdsMissing && bridges.data.length === 0 ? (
              <p className="mt-4">No hay puentes configurados en esta área de trabajo.</p>
            ) : null}
            {!bridges.loading && !bridges.error && bridges.data.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 pr-3">Origen</th>
                      <th className="py-2 pr-3">Tópico destino</th>
                      <th className="py-2 pr-3">Estado</th>
                      <th className="py-2 pr-3">Entrega</th>
                      <th className="py-2">Auditoría</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bridges.data.map((bridge) => (
                      <tr className="border-b border-border/60" key={bridge.bridgeId}>
                        <td className="py-3 pr-3">{formatValue(bridge.source?.sourceType)} {bridge.source?.sourceRef ? `· ${bridge.source.sourceRef}` : ''}</td>
                        <td className="py-3 pr-3">{bridge.topicRef}</td>
                        <td className="py-3 pr-3"><Badge variant={statusTone(bridge.status)}>{formatEnumLabel(bridge.status)}</Badge></td>
                        <td className="py-3 pr-3">{formatValue(bridge.delivery?.mode)}</td>
                        <td className="py-3">{formatValue(bridge.audit?.enabled ?? bridge.audit?.mode)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </div>

        <section className="min-w-0 rounded-xl border border-border p-4">
          {!selectedTopicId ? (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Detalle del tópico</h2>
              <p className="text-sm text-muted-foreground">Selecciona un tópico del inventario para revisar detalle, acceso, metadatos, publicar eventos o abrir un flujo SSE.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{topicDetail.data?.topicName ?? selectedTopic?.topicName ?? 'Tópico seleccionado'}</h2>
                <Badge variant={statusTone(topicDetail.data?.provisioning?.state ?? selectedTopic?.provisioning?.state ?? selectedTopic?.status)}>
                  {formatEnumLabel(topicDetail.data?.provisioning?.state ?? selectedTopic?.provisioning?.state ?? selectedTopic?.status)}
                </Badge>
                {quotaHighlighted(topicDetail.data?.quotaStatus ?? selectedTopic?.quotaStatus) ? (
                  <Badge variant="secondary">{quotaLabel(topicDetail.data?.quotaStatus ?? selectedTopic?.quotaStatus)}</Badge>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {(['detail', 'access', 'metadata', 'publish', 'stream'] as TopicTab[]).map((tab) => (
                  <Button key={tab} onClick={() => setTopicDetailTab(tab)} type="button" variant={topicDetailTab === tab ? 'default' : 'outline'}>
                    {topicTabLabel(tab)}
                  </Button>
                ))}
              </div>

              {topicDetailTab === 'detail' ? (
                <div className="space-y-4">
                  {topicDetail.loading ? <p>Cargando detalle…</p> : null}
                  {!topicDetail.loading && topicDetail.error ? <p role="alert">{topicDetail.error}</p> : null}
                  {!topicDetail.loading && !topicDetail.error && topicDetail.data ? (
                    <>
                      <section className="space-y-3">
                        <h3 className="font-semibold">Identificación</h3>
                        <KeyValueGrid items={[
                          { label: 'Nombre del tópico', value: topicDetail.data.topicName },
                          { label: 'Nombre físico del tópico', value: topicDetail.data.physicalTopicName },
                          { label: 'Prefijo de canal', value: topicDetail.data.channelPrefix },
                          { label: 'ID del recurso', value: topicDetail.data.resourceId }
                        ]} />
                      </section>
                      <section className="space-y-3">
                        <h3 className="font-semibold">Configuración</h3>
                        <KeyValueGrid items={[
                          { label: 'Particiones', value: topicDetail.data.partitionCount },
                          { label: 'Factor de replicación', value: topicDetail.data.replicationFactor },
                          { label: 'Retención (horas)', value: topicDetail.data.retentionHours },
                          { label: 'Política de cleanup', value: formatCleanupPolicy(topicDetail.data.cleanupPolicy) },
                          { label: 'Semántica de entrega', value: formatDeliverySemantics(topicDetail.data.deliverySemantics) },
                          { label: 'Estrategia de partición', value: formatEnumLabel(topicDetail.data.partitionStrategy) },
                          { label: 'Ventana de replay (horas)', value: topicDetail.data.replayWindowHours }
                        ]} />
                      </section>
                      <section className="space-y-3">
                        <h3 className="font-semibold">Políticas</h3>
                        <KeyValueGrid items={[
                          { label: 'Replay habilitado', value: topicDetail.data.replayPolicy?.enabled },
                          { label: 'Servicio de reproducción', value: topicDetail.data.replayPolicy?.storageBackend },
                          { label: 'Ventana máxima de replay', value: topicDetail.data.replayPolicy?.maxReplayWindowHours },
                          { label: 'Contenido máximo (bytes)', value: topicDetail.data.payloadPolicy?.maxPayloadBytes },
                          { label: 'Compresión', value: topicDetail.data.payloadPolicy?.compressionHint },
                          { label: 'Validación de esquema', value: topicDetail.data.payloadPolicy?.schemaValidation },
                          { label: 'Colas habilitadas', value: topicDetail.data.notificationPolicy?.queuesEnabled },
                          { label: 'Profundidad máxima de cola', value: topicDetail.data.notificationPolicy?.maxQueueDepth },
                          { label: 'Retención de notificaciones', value: topicDetail.data.notificationPolicy?.retentionHours }
                        ]} />
                      </section>
                      <section className="space-y-3">
                        <h3 className="font-semibold">Transportes</h3>
                        <p>{topicDetail.data.allowedTransports?.length ? topicDetail.data.allowedTransports.join(', ') : '—'}</p>
                      </section>
                      <section className="space-y-3">
                        <h3 className="font-semibold">Cuotas</h3>
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-left text-sm">
                            <thead>
                              <tr className="border-b border-border text-muted-foreground">
                                <th className="py-2 pr-3">Límite</th>
                                <th className="py-2 pr-3">Usado</th>
                                <th className="py-2 pr-3">Restante</th>
                                <th className="py-2 pr-3">Aplicación de límites</th>
                                <th className="py-2 pr-3">Publicaciones/s</th>
                                <th className="py-2">Subscripciones</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td className="py-2 pr-3">{formatValue(topicDetail.data.quotaStatus?.limit)}</td>
                                <td className="py-2 pr-3">{formatValue(topicDetail.data.quotaStatus?.used)}</td>
                                <td className="py-2 pr-3">{formatValue(topicDetail.data.quotaStatus?.remaining)}</td>
                                <td className="py-2 pr-3">
                                  {quotaHighlighted(topicDetail.data.quotaStatus) ? (
                                    <Badge variant="secondary">{formatValue(topicDetail.data.quotaStatus?.enforcementMode)}</Badge>
                                  ) : (
                                    formatValue(topicDetail.data.quotaStatus?.enforcementMode)
                                  )}
                                </td>
                                <td className="py-2 pr-3">{formatValue(topicDetail.data.quotaStatus?.maxPublishesPerSecond ?? topicDetail.data.maxPublishesPerSecond)}</td>
                                <td className="py-2">{formatValue(topicDetail.data.quotaStatus?.maxConcurrentSubscriptions ?? topicDetail.data.maxConcurrentSubscriptions)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </section>
                      <section className="space-y-3">
                        <h3 className="font-semibold">Aislamiento de organización</h3>
                        <KeyValueGrid items={[
                          { label: 'Modo', value: topicDetail.data.tenantIsolation?.mode },
                          { label: 'Prefijo de tópico', value: topicDetail.data.tenantIsolation?.topicPrefix },
                          { label: 'Prefijo de consumer group', value: topicDetail.data.tenantIsolation?.consumerGroupPrefix },
                          { label: 'Acceso entre organizaciones prevenido', value: topicDetail.data.tenantIsolation?.crossTenantAccessPrevented }
                        ]} />
                      </section>
                      <section className="space-y-3">
                        <h3 className="font-semibold">Marcas temporales</h3>
                        <KeyValueGrid items={[
                          { label: 'Creado en', value: topicDetail.data.timestamps?.createdAt },
                          { label: 'Actualizado en', value: topicDetail.data.timestamps?.updatedAt }
                        ]} />
                      </section>
                    </>
                  ) : null}
                </div>
              ) : null}

              {topicDetailTab === 'access' ? (
                <div className="space-y-4">
                  {topicAccess.loading ? <p>Cargando política de acceso…</p> : null}
                  {!topicAccess.loading && topicAccess.error ? <p role="alert">{topicAccess.error}</p> : null}
                  {!topicAccess.loading && !topicAccess.error && topicAccess.data ? (
                    <>
                      <KeyValueGrid items={[
                        { label: 'Modo de auditoría', value: topicAccess.data.auditMode },
                        { label: 'Proveedor', value: topicAccess.data.providerCompatibility?.provider },
                        { label: 'Soporte ACL nativo', value: topicAccess.data.providerCompatibility?.nativeAclSupport }
                      ]} />
                      {topicAccess.data.aclBindings.length === 0 ? <p>No hay vinculaciones ACL configuradas.</p> : null}
                      {topicAccess.data.aclBindings.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-left text-sm">
                            <thead>
                              <tr className="border-b border-border text-muted-foreground">
                                <th className="py-2 pr-3">Principal</th>
                                <th className="py-2 pr-3">Operaciones</th>
                                <th className="py-2 pr-3">Permiso</th>
                                <th className="py-2 pr-3">Tipo</th>
                                <th className="py-2 pr-3">Recurso</th>
                                <th className="py-2">Acotado al área de trabajo</th>
                              </tr>
                            </thead>
                            <tbody>
                              {topicAccess.data.aclBindings.map((binding, index) => (
                                <tr className="border-b border-border/60" key={`${binding.principal}-${index}`}>
                                  <td className="py-2 pr-3">{binding.principal}</td>
                                  <td className="py-2 pr-3">{binding.operations?.join(', ') || '—'}</td>
                                  <td className="py-2 pr-3"><Badge variant={binding.permission === 'DENY' ? 'destructive' : 'default'}>{formatValue(binding.permission)}</Badge></td>
                                  <td className="py-2 pr-3">{formatValue(binding.patternType)}</td>
                                  <td className="py-2 pr-3">{binding.resourceName || '—'}</td>
                                  <td className="py-2">{formatValue(binding.workspaceScoped)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}

              {topicDetailTab === 'metadata' ? (
                <div className="space-y-4">
                  {topicMetadata.loading ? <p>Cargando metadatos operacionales…</p> : null}
                  {!topicMetadata.loading && topicMetadata.error ? <p role="alert">{topicMetadata.error}</p> : null}
                  {!topicMetadata.loading && !topicMetadata.error && topicMetadata.data ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={lagSummary.tone}>{lagSummary.label}</Badge>
                        <span className="text-sm text-muted-foreground">Muestreo {formatRelativeDate(topicMetadata.data.sampledAt)}</span>
                      </div>
                      <section className="space-y-3">
                        <h3 className="font-semibold">Lag</h3>
                        <KeyValueGrid items={[
                          { label: 'Retraso total', value: topicMetadata.data.lag?.totalLag },
                          { label: 'Retraso máximo de partición', value: topicMetadata.data.lag?.maxPartitionLag },
                          { label: 'Grupo consumidor', value: topicMetadata.data.lag?.consumerGroupId },
                          { label: 'Activo', value: topicMetadata.data.lag?.isActive ?? topicMetadata.data.lag?.available }
                        ]} />
                      </section>
                      <section className="space-y-3">
                        <h3 className="font-semibold">Retención efectiva</h3>
                        <KeyValueGrid items={[
                          { label: 'Horas de retención', value: topicMetadata.data.retention?.retentionHours },
                          { label: 'Bytes de retención', value: topicMetadata.data.retention?.retentionBytes },
                          { label: 'Política efectiva', value: topicMetadata.data.retention?.effectivePolicy }
                        ]} />
                      </section>
                      <section className="space-y-3">
                        <h3 className="font-semibold">Compactación</h3>
                        <KeyValueGrid items={[
                          { label: 'Habilitada', value: topicMetadata.data.compaction?.enabled ?? topicMetadata.data.compaction?.available },
                          { label: 'Última compactación', value: topicMetadata.data.compaction?.lastCompactionTimestamp },
                          { label: 'Retraso de compactación', value: topicMetadata.data.compaction?.compactionLag }
                        ]} />
                      </section>
                      {topicMetadata.data.partitionMetadata && !('available' in topicMetadata.data.partitionMetadata) ? (
                        <section className="space-y-3">
                          <h3 className="font-semibold">Particiones</h3>
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-left text-sm">
                              <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                  <th className="py-2 pr-3">Partición</th>
                                  <th className="py-2 pr-3">Retraso</th>
                                  <th className="py-2 pr-3">Offset inicial</th>
                                  <th className="py-2 pr-3">Offset final</th>
                                  <th className="py-2">Sincronizada</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(topicMetadata.data.partitionMetadata).map(([partition, metadata]) => (
                                  <tr className="border-b border-border/60" key={partition}>
                                    <td className="py-2 pr-3">{partition}</td>
                                    <td className="py-2 pr-3">{formatValue(metadata.lag)}</td>
                                    <td className="py-2 pr-3">{formatValue(metadata.logStartOffset)}</td>
                                    <td className="py-2 pr-3">{formatValue(metadata.logEndOffset)}</td>
                                    <td className="py-2">{formatValue(metadata.inSync)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </section>
                      ) : null}
                      {topicMetadata.data.technicalLimitations?.length ? (
                        <section className="space-y-2">
                          <h3 className="font-semibold">Limitaciones técnicas</h3>
                          {topicMetadata.data.technicalLimitations.map((limitation, index) => {
                            if (typeof limitation === 'string') {
                              return <div className="rounded-lg border border-destructive/40 p-3 text-sm" key={`${limitation}-${index}`} role="alert">{limitation}</div>
                            }
                            return (
                              <div className="rounded-lg border border-destructive/40 p-3 text-sm" key={`${limitation.code ?? 'lim'}-${index}`} role="alert">
                                <strong>{limitation.code ?? 'LIMITATION'}</strong>: {limitation.description ?? limitation.affectedField ?? 'Sin descripción'}
                              </div>
                            )
                          })}
                        </section>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}

              {topicDetailTab === 'publish' ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium" htmlFor="kafka-publish-payload">Contenido JSON</label>
                    <textarea className="min-h-36 w-full rounded-md border border-input bg-background p-3 text-sm" id="kafka-publish-payload" placeholder="{}" value={publishForm.payload} onChange={(event) => setPublishForm((current) => ({ ...current, payload: event.target.value }))} />
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <label className="block text-sm font-medium">Tipo de evento
                      <input className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="com.example.event" type="text" value={publishForm.eventType} onChange={(event) => setPublishForm((current) => ({ ...current, eventType: event.target.value }))} />
                    </label>
                    <label className="block text-sm font-medium">Clave
                      <input className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="(opcional)" type="text" value={publishForm.key} onChange={(event) => setPublishForm((current) => ({ ...current, key: event.target.value }))} />
                    </label>
                    <label className="block text-sm font-medium">Tipo de contenido
                      <input className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" type="text" value={publishForm.contentType} onChange={(event) => setPublishForm((current) => ({ ...current, contentType: event.target.value }))} />
                    </label>
                  </div>
                  <Button disabled={publishResult.loading} onClick={() => void handlePublish()} type="button">{publishResult.loading ? 'Publicando…' : 'Publicar evento'}</Button>
                  {publishResult.error ? (
                    <div className="rounded-lg border border-destructive/40 p-3 text-sm" role="alert">
                      <p>{publishResult.error}</p>
                      {publishRateLimited ? <p className="mt-2 text-muted-foreground">Revisa la pestaña Detalle &gt; Cuotas para validar límites o aplicación de límites.</p> : null}
                    </div>
                  ) : null}
                  {publishResult.data ? (
                    <div className="rounded-lg border border-border p-3 text-sm" role="status">
                      <p><strong>ID de publicación:</strong> {publishResult.data.publicationId}</p>
                      <p><strong>Estado:</strong> {publishResult.data.status}</p>
                      <p><strong>Aceptada en:</strong> {publishResult.data.acceptedAt ?? '—'}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {topicDetailTab === 'stream' ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Button aria-label={streamActive ? 'Detener flujo' : 'Iniciar flujo'} onClick={() => (streamActive ? stopStream() : void startStream(selectedTopicId))} type="button">
                      {streamActive ? 'Detener flujo' : 'Iniciar flujo'}
                    </Button>
                    {streamActive ? <Badge variant="default">Conexión activa</Badge> : <Badge variant="outline">Inactivo</Badge>}
                  </div>
                  {showHighVolumeWarning ? <p role="alert">Alto volumen de eventos; la visualización puede estar retrasada respecto al broker.</p> : null}
                  {streamError ? <p role="alert">{streamError}</p> : null}
                  <div className="max-h-[400px] space-y-3 overflow-y-auto rounded-lg border border-border p-3">
                    {streamEvents.length === 0 && streamActive ? <p>Escuchando eventos…</p> : null}
                    {streamEvents.length === 0 && !streamActive ? <p>Inicia el flujo para recibir eventos.</p> : null}
                    {streamEvents.map((event, index) => (
                      <article className="rounded-lg border border-border p-3 text-sm" key={`${event.receivedAt}-${index}`}>
                        <div className="mb-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>{event.receivedAt}</span>
                          {event.key ? <span>clave: {event.key}</span> : null}
                          {event.eventType ? <span>tipoEvento: {event.eventType}</span> : null}
                        </div>
                        <p className="mb-2 text-xs text-muted-foreground">crudo: {event.raw}</p>
                        <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload, null, 2)}</pre>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </section>
    </section>
  )
}
