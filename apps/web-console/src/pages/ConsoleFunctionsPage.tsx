import { type KeyboardEvent, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lock, Play, Rocket, RotateCcw, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ConnectionSnippets } from '@/components/console/ConnectionSnippets'
import { DestructiveConfirmationDialog } from '@/components/console/DestructiveConfirmationDialog'
import { useDestructiveOp } from '@/components/console/hooks/useDestructiveOp'
import { WorkspaceRequiredState } from '@/components/console/WorkspaceRequiredState'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useConsoleContext } from '@/lib/console-context'
import { describeConsoleError, getConsoleErrorStatus } from '@/lib/console-errors'
import { requestConsoleSessionJson } from '@/lib/console-session'
import { DESTRUCTIVE_OP_LEVELS } from '@/lib/destructive-ops'
import { parseJsonObject, prettyJson } from '@/lib/editor-ux'
import type { SnippetContext } from '@/lib/snippets/snippet-types'
import { cn } from '@/lib/utils'
import { deleteFunction } from '@/services/functionsApi'

type FunctionExecutionLimits = {
  timeoutMs?: number
  memoryMb?: number
  logSizeKb?: number
  concurrentInvocations?: number
}

type FunctionExecutionConfiguration = {
  entrypoint?: string
  runtime?: string
  environment?: Record<string, string>
  limits?: FunctionExecutionLimits
  parameters?: Record<string, unknown>
  secretRefs?: string[]
}

type FunctionDeploymentSource = {
  kind?: string
  inlineCode?: string
  artifactRef?: string
  imageRef?: string
  entryFile?: string
  digest?: string
}

type ProvisioningState = {
  state?: string
  failureClass?: string
  gatingMode?: string
}

type LifecycleTimestamps = {
  createdAt?: string
  updatedAt?: string
}

type FunctionActivationPolicy = {
  mode?: string
  retentionDays?: number
  logsRetained?: boolean
  resultRetained?: boolean
}

type FunctionSecretReference = {
  secretName: string
  injectionMode?: string
}

type FunctionHttpExposure = {
  enabled?: boolean
  publicUrl?: string
  authPolicy?: string
  status?: string
}

type FunctionKafkaTriggerSummary = {
  triggerId?: string
  topicRef?: string
  status?: string
  deliveryMode?: string
}

type FunctionCronTrigger = {
  triggerId?: string
  schedule?: string
  timezone?: string
  status?: string
  overlapPolicy?: string
}

type FunctionStorageTrigger = {
  triggerId?: string
  bucketRef?: string
  eventTypes?: string[]
  status?: string
}

type FunctionQuotaStatus = {
  limit?: number
  used?: number
  remaining?: number
  enforcementMode?: string
}

type FunctionActivation = {
  activationId: string
  resourceId: string
  status: string
  startedAt: string
  finishedAt?: string
  durationMs: number
  triggerKind: string
  statusCode?: number
  memoryMb?: number
  invocationId?: string
  policy?: FunctionActivationPolicy
}

type FunctionAction = {
  resourceId: string
  tenantId?: string
  workspaceId?: string
  actionName: string
  packageName?: string
  namespaceName?: string
  subjectRef?: string
  status?: string
  activeVersionId?: string
  rollbackAvailable?: boolean
  versionCount?: number
  unresolvedSecretRefs?: number
  deploymentDigest?: string
  execution: FunctionExecutionConfiguration
  activationPolicy?: FunctionActivationPolicy
  source: FunctionDeploymentSource
  provisioning?: ProvisioningState
  httpExposure?: FunctionHttpExposure
  kafkaTriggers?: FunctionKafkaTriggerSummary[]
  cronTriggers?: FunctionCronTrigger[]
  storageTriggers?: FunctionStorageTrigger[]
  secretReferences?: FunctionSecretReference[]
  latestActivation?: FunctionActivation
  timestamps?: LifecycleTimestamps
}

type FunctionInventory = {
  workspaceId: string
  actions: FunctionAction[]
  counts?: {
    actions?: number
    packages?: number
    rules?: number
    triggers?: number
    httpExposures?: number
  }
  quotaStatus?: FunctionQuotaStatus
}

type FunctionVersion = {
  versionId: string
  resourceId: string
  versionNumber?: number
  status?: string
  originType?: string
  rollbackEligible?: boolean
  deploymentDigest?: string
  execution?: FunctionExecutionConfiguration
  source?: FunctionDeploymentSource
  activationPolicy?: FunctionActivationPolicy
  timestamps?: LifecycleTimestamps
}

type FunctionVersionCollection = {
  items: FunctionVersion[]
  page?: { size?: number; nextCursor?: string }
}

type FunctionActivationCollection = {
  items: FunctionActivation[]
  page?: { total?: number; after?: string }
}

type FunctionActivationLog = {
  activationId: string
  lines: string[]
  truncated: boolean
  policy?: FunctionActivationPolicy
}

type FunctionActivationResult = {
  activationId: string
  status: string
  result?: unknown
  contentType?: string
  policy?: FunctionActivationPolicy
}

type FunctionActivationDetail = {
  activation: FunctionActivation | null
  logs: FunctionActivationLog | null
  result: FunctionActivationResult | null
  activationError: string | null
  logsError: string | null
  resultError: string | null
}

type FunctionInvocationWriteRequest = {
  parameters?: Record<string, unknown>
  responseMode?: 'accepted' | 'wait_for_result'
  idempotencyScope?: 'request' | 'payload_digest'
}

type FunctionInvocationAccepted = {
  invocationId: string
  resourceId: string
  status: string
  acceptedAt: string
  activationId?: string
  result?: unknown
  contentType?: string
  logs?: string[]
  durationMs?: number
  activationPolicy?: FunctionActivationPolicy
}

type FunctionActionWriteRequest = {
  tenantId: string
  workspaceId: string
  actionName: string
  execution: FunctionExecutionConfiguration
  source: FunctionDeploymentSource
  activationPolicy: FunctionActivationPolicy
}

type GatewayMutationAccepted = import('@/services/functionsApi').GatewayMutationAccepted

type FunctionRollbackWriteRequest = {
  versionId: string
  reason?: string
}

type FunctionRollbackAccepted = {
  requestId: string
  resourceId: string
  requestedVersionId: string
  status: string
  correlationId: string
  acceptedAt: string
}

type SectionState<T> = { data: T; loading: boolean; error: string | null }
type FunctionDetailTab = 'detail' | 'versions' | 'activations' | 'triggers' | 'invoke' | 'deploy'

type DeployFormState = {
  mode: 'create' | 'edit'
  actionName: string
  runtime: string
  entrypoint: string
  inlineCode: string
  timeoutMs: string
  memoryMb: string
}

const EMPTY_INVENTORY_STATE: SectionState<FunctionInventory | null> = { data: null, loading: false, error: null }
const EMPTY_ACTION_DETAIL_STATE: SectionState<FunctionAction | null> = { data: null, loading: false, error: null }
const EMPTY_VERSIONS_STATE: SectionState<FunctionVersionCollection | null> = { data: null, loading: false, error: null }
const EMPTY_ACTIVATIONS_STATE: SectionState<FunctionActivationCollection | null> = { data: null, loading: false, error: null }
const EMPTY_INVOKE_RESULT_STATE: SectionState<FunctionInvocationAccepted | null> = { data: null, loading: false, error: null }
const EMPTY_DEPLOY_RESULT_STATE: SectionState<FunctionAction | GatewayMutationAccepted | null> = { data: null, loading: false, error: null }
const EMPTY_ROLLBACK_RESULT_STATE: SectionState<FunctionRollbackAccepted | null> = { data: null, loading: false, error: null }
const EMPTY_ACTIVATION_DETAIL: SectionState<FunctionActivationDetail> = {
  data: { activation: null, logs: null, result: null, activationError: null, logsError: null, resultError: null },
  loading: false,
  error: null
}
const EMPTY_DEPLOY_FORM: DeployFormState = {
  mode: 'edit',
  actionName: '',
  runtime: '',
  entrypoint: '',
  inlineCode: '',
  timeoutMs: '',
  memoryMb: ''
}

const FUNCTION_DETAIL_TABS: Array<{ value: FunctionDetailTab; label: string }> = [
  { value: 'detail', label: 'Detalle' },
  { value: 'versions', label: 'Versiones' },
  { value: 'activations', label: 'Activaciones' },
  { value: 'triggers', label: 'Disparadores' },
  { value: 'invoke', label: 'Invocar' },
  { value: 'deploy', label: 'Desplegar' }
]

const FUNCTION_RUNTIME_OPTIONS = ['nodejs:20', 'nodejs:18']
const pagePanelClassName = 'rounded-3xl border border-border bg-card/70 p-5 shadow-sm sm:p-6'
const nestedPanelClassName = 'rounded-2xl border border-border/70 bg-background/50 p-4'
const emptyStateClassName = 'rounded-2xl border border-dashed border-border/70 bg-background/40 px-4 py-5 text-sm leading-6 text-muted-foreground'
const loadingTextClassName = 'text-sm leading-6 text-muted-foreground'
const rowButtonClassName = 'w-full rounded-2xl border border-border/70 bg-background/40 p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const writeDisabledNoticeClassName = 'flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-sm leading-5 text-amber-100'

function getFunctionTabId(tab: FunctionDetailTab) {
  return `functions-${tab}-tab`
}

function getFunctionPanelId(tab: FunctionDetailTab) {
  return `functions-${tab}-panel`
}

function isAbortError(rawError: unknown): boolean {
  return rawError instanceof DOMException && rawError.name === 'AbortError'
}

function formatEnumLabel(value?: string | null): string {
  if (!value) return '—'
  return value.replace(/_/g, ' ')
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return '—'
  return prettyJson(value)
}

// Narrow, intentional exception to "never read `.message`" (#743): this ONLY feeds a
// keyword match that selects between two hardcoded, safe Spanish strings below — the raw text
// itself is never rendered. Any error that doesn't match falls through to `describeConsoleError`.
function rawErrorMessageForKeywordMatch(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error && typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message
    : ''
}

function getActivationUnavailableMessage(error: unknown, fallback: string): string {
  const normalized = rawErrorMessageForKeywordMatch(error).toLowerCase()
  if (
    getConsoleErrorStatus(error) === 404 ||
    normalized.includes('404') ||
    normalized.includes('not found') ||
    normalized.includes('no encontrada') ||
    normalized.includes('no encontrado')
  ) {
    return 'Esta activación ya no está disponible.'
  }
  return describeConsoleError(error, fallback)
}

function getActivationLogsMessage(error: unknown, fallback: string): string {
  const normalized = rawErrorMessageForKeywordMatch(error).toLowerCase()
  if (getConsoleErrorStatus(error) === 403 || normalized.includes('403') || normalized.includes('permiso') || normalized.includes('forbidden')) {
    return 'No tienes permisos para ver los registros de esta activación.'
  }
  return getActivationUnavailableMessage(error, fallback)
}

function statusToneClass(value?: string | null): string {
  const normalized = value?.toLowerCase()
  if (!normalized) return 'border-border text-muted-foreground'
  if (['active', 'succeeded', 'success', 'completed', 'available'].includes(normalized)) {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
  }
  if (['failed', 'failure', 'error', 'invalid', 'degraded', 'timed_out', 'cancelled'].includes(normalized)) {
    return 'border-red-500/40 bg-red-500/10 text-red-300'
  }
  if (['accepted', 'queued', 'running', 'provisioning', 'deploying'].includes(normalized)) {
    return 'border-sky-500/40 bg-sky-500/10 text-sky-300'
  }
  if (['suspended', 'historical', 'inactive'].includes(normalized)) {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-300'
  }
  return 'border-border bg-muted/40 text-muted-foreground'
}

function buildIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `fn_${Date.now()}`
}

function getActionWriteState(action: FunctionAction | null): string | null {
  const provisioningState = action?.provisioning?.state?.toLowerCase().trim()
  const status = action?.status?.toLowerCase().trim()
  return provisioningState || status || null
}

function getWriteDisabledReason(action: FunctionAction | null): string | null {
  const state = getActionWriteState(action)
  if (state === 'provisioning') {
    return 'Las acciones de escritura están deshabilitadas mientras la función termina de aprovisionarse.'
  }
  if (state === 'degraded') {
    return 'Las acciones de escritura están deshabilitadas porque el aprovisionamiento de la función está degradado.'
  }
  if (state === 'suspended') {
    return 'Las acciones de escritura están deshabilitadas porque la función está suspendida.'
  }
  // Managed Knative outage states (#933): a delete is accepted as `deletion_pending` cleanup and
  // every other write (deploy/update, invoke, rollback) is non-actionable while the runtime is
  // unavailable — surface an honest explanation instead of letting the affordances look usable.
  if (state === 'unavailable') {
    return 'Las acciones de escritura están deshabilitadas porque el runtime de Knative no está disponible.'
  }
  if (state === 'deletion_pending') {
    return 'Las acciones de escritura están deshabilitadas porque la eliminación de la función está pendiente de limpieza.'
  }
  return null
}

function FunctionStatusBadge({ value }: { value?: string | null }) {
  return (
    <Badge variant="outline" className={cn('max-w-full whitespace-normal break-words text-left capitalize', statusToneClass(value))}>
      {formatEnumLabel(value)}
    </Badge>
  )
}

function WriteDisabledNotice({ id, reason, className }: { id?: string; reason: string; className?: string }) {
  return (
    <p className={cn(writeDisabledNoticeClassName, className)}>
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
      <span id={id} className="min-w-0">
        <span className="font-medium text-amber-50">Escritura bloqueada.</span> {reason}
      </span>
    </p>
  )
}

function ConsoleBlock({ children, className, testId }: { children: string; className?: string; testId?: string }) {
  return (
    <pre
      className={cn('max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-muted/30 p-3 font-mono text-xs leading-5 text-foreground', className)}
      data-testid={testId}
      spellCheck={false}
    >
      {children}
    </pre>
  )
}

function formatResultForDisplay(result: unknown): string {
  if (result === null) return 'null'
  return typeof result === 'string' ? result : prettyJson(result)
}

function resolveActivationIdFromInvocation(
  invocation: FunctionInvocationAccepted,
  collection: FunctionActivationCollection | null
): string | null {
  if (invocation.activationId) return invocation.activationId
  const matchingActivation = collection?.items.find((item) => item.invocationId === invocation.invocationId)
  if (matchingActivation) return matchingActivation.activationId
  if (invocation.invocationId?.startsWith('act_')) return invocation.invocationId
  return collection?.items[0]?.activationId ?? null
}

function runtimeOptionsFor(value: string): string[] {
  if (!value || FUNCTION_RUNTIME_OPTIONS.includes(value)) return FUNCTION_RUNTIME_OPTIONS
  return [value, ...FUNCTION_RUNTIME_OPTIONS]
}

function KeyValueGrid({ items }: { items: Array<{ label: string; value: unknown; mono?: boolean }> }) {
  return (
    <dl className="grid gap-3 md:grid-cols-2">
      {items.map((item) => (
        <div className={nestedPanelClassName} key={item.label}>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{item.label}</dt>
          <dd className={cn('mt-1 min-w-0 break-words text-sm leading-6 text-foreground', item.mono && 'break-all font-mono text-xs')}>
            {isValidElement(item.value) ? item.value : formatValue(item.value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function ConsoleFunctionsPage() {
  const { activeTenantId, activeWorkspaceId } = useConsoleContext()
  const [inventory, setInventory] = useState<SectionState<FunctionInventory | null>>(EMPTY_INVENTORY_STATE)
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null)
  const [actionDetailTab, setActionDetailTab] = useState<FunctionDetailTab>('detail')
  const [actionDetail, setActionDetail] = useState<SectionState<FunctionAction | null>>(EMPTY_ACTION_DETAIL_STATE)
  const [versions, setVersions] = useState<SectionState<FunctionVersionCollection | null>>(EMPTY_VERSIONS_STATE)
  const [activations, setActivations] = useState<SectionState<FunctionActivationCollection | null>>(EMPTY_ACTIVATIONS_STATE)
  const [selectedActivationId, setSelectedActivationId] = useState<string | null>(null)
  const [activationDetail, setActivationDetail] = useState<SectionState<FunctionActivationDetail>>(EMPTY_ACTIVATION_DETAIL)
  const [invokeForm, setInvokeForm] = useState<{ parametersJson: string; responseMode: 'accepted' | 'wait_for_result' }>({ parametersJson: prettyJson({}), responseMode: 'accepted' })
  const [invokeResult, setInvokeResult] = useState<SectionState<FunctionInvocationAccepted | null>>(EMPTY_INVOKE_RESULT_STATE)
  const [deployForm, setDeployForm] = useState<DeployFormState>(EMPTY_DEPLOY_FORM)
  const [deployResult, setDeployResult] = useState<SectionState<FunctionAction | GatewayMutationAccepted | null>>(EMPTY_DEPLOY_RESULT_STATE)
  const [rollbackTargetVersionId, setRollbackTargetVersionId] = useState<string | null>(null)
  const [rollbackResult, setRollbackResult] = useState<SectionState<FunctionRollbackAccepted | null>>(EMPTY_ROLLBACK_RESULT_STATE)
  const [deleteFeedback, setDeleteFeedback] = useState<string | null>(null)
  const destructiveOp = useDestructiveOp()
  const invokeIdempotencyKeyRef = useRef(buildIdempotencyKey())
  const deployIdempotencyKeyRef = useRef(buildIdempotencyKey())
  const rollbackIdempotencyKeyRef = useRef(buildIdempotencyKey())
  const deleteIdempotencyKeyRef = useRef(buildIdempotencyKey())

  const resetActionState = useCallback(() => {
    setActionDetail(EMPTY_ACTION_DETAIL_STATE)
    setVersions(EMPTY_VERSIONS_STATE)
    setActivations(EMPTY_ACTIVATIONS_STATE)
    setSelectedActivationId(null)
    setActivationDetail(EMPTY_ACTIVATION_DETAIL)
    setInvokeResult(EMPTY_INVOKE_RESULT_STATE)
    setDeployResult(EMPTY_DEPLOY_RESULT_STATE)
    setRollbackTargetVersionId(null)
    setRollbackResult(EMPTY_ROLLBACK_RESULT_STATE)
    setActionDetailTab('detail')
    setDeployForm(EMPTY_DEPLOY_FORM)
  }, [])

  const loadInventory = useCallback(async (workspaceId: string, signal?: AbortSignal) => {
    setInventory((current) => ({ ...current, loading: true, error: null }))
    try {
      const data = await requestConsoleSessionJson<FunctionInventory>(`/v1/functions/workspaces/${workspaceId}/inventory`, { signal })
      setInventory({ data, loading: false, error: null })
      return
    } catch (error) {
      if (isAbortError(error)) return
      try {
        const fallback = await requestConsoleSessionJson<{ items: FunctionAction[] }>(`/v1/functions/workspaces/${workspaceId}/actions?page[size]=50`, { signal })
        setInventory({
          data: { workspaceId, actions: fallback.items ?? [], counts: { actions: fallback.items?.length ?? 0 } },
          loading: false,
          error: null
        })
      } catch (fallbackError) {
        if (isAbortError(fallbackError)) return
        setInventory({ data: null, loading: false, error: describeConsoleError(fallbackError, describeConsoleError(error, 'No se pudo cargar el inventario de funciones.')) })
      }
    }
  }, [])

  const loadActionDetail = useCallback(async (resourceId: string, signal?: AbortSignal) => {
    setActionDetail((current) => ({ ...current, loading: true, error: null }))
    try {
      const data = await requestConsoleSessionJson<FunctionAction>(`/v1/functions/actions/${resourceId}`, { signal })
      setActionDetail({ data, loading: false, error: null })
    } catch (error) {
      if (isAbortError(error)) return
      setActionDetail({ data: null, loading: false, error: describeConsoleError(error, 'No se pudo cargar el detalle de la función.') })
    }
  }, [])

  const loadVersions = useCallback(async (resourceId: string, signal?: AbortSignal) => {
    setVersions((current) => ({ ...current, loading: true, error: null }))
    try {
      const data = await requestConsoleSessionJson<FunctionVersionCollection>(`/v1/functions/actions/${resourceId}/versions?page[size]=50`, { signal })
      setVersions({ data, loading: false, error: null })
      const eligible = data.items.find((item) => item.rollbackEligible)
      setRollbackTargetVersionId(eligible?.versionId ?? null)
    } catch (error) {
      if (isAbortError(error)) return
      setVersions({ data: null, loading: false, error: describeConsoleError(error, 'No se pudo cargar el historial de versiones.') })
    }
  }, [])

  const loadActivations = useCallback(async (resourceId: string, signal?: AbortSignal) => {
    setActivations((current) => ({ ...current, loading: true, error: null }))
    try {
      const data = await requestConsoleSessionJson<FunctionActivationCollection>(`/v1/functions/actions/${resourceId}/activations?page[size]=50`, { signal })
      setActivations({ data, loading: false, error: null })
      return data
    } catch (error) {
      if (isAbortError(error)) return null
      setActivations({ data: null, loading: false, error: describeConsoleError(error, 'No se pudo cargar las activaciones.') })
      return null
    }
  }, [])

  const openCreateMode = useCallback(() => {
    setSelectedActionId(null)
    resetActionState()
    setActionDetailTab('deploy')
    setDeployForm({ ...EMPTY_DEPLOY_FORM, mode: 'create' })
  }, [resetActionState])

  useEffect(() => {
    destructiveOp.handleCancel()
    setDeleteFeedback(null)
    setInventory(EMPTY_INVENTORY_STATE)
    setSelectedActionId(null)
    resetActionState()

    if (!activeWorkspaceId) return undefined

    const controller = new AbortController()
    void loadInventory(activeWorkspaceId, controller.signal)
    return () => controller.abort()
  }, [activeTenantId, activeWorkspaceId, destructiveOp.handleCancel, loadInventory, resetActionState])

  useEffect(() => {
    if (!selectedActionId) {
      setActionDetailTab((current) => (deployForm.mode === 'create' ? 'deploy' : current))
      return undefined
    }

    setActionDetailTab('detail')
    setVersions(EMPTY_VERSIONS_STATE)
    setActivations(EMPTY_ACTIVATIONS_STATE)
    setSelectedActivationId(null)
    setActivationDetail(EMPTY_ACTIVATION_DETAIL)
    setInvokeResult(EMPTY_INVOKE_RESULT_STATE)
    setDeployResult(EMPTY_DEPLOY_RESULT_STATE)
    setRollbackTargetVersionId(null)
    setRollbackResult(EMPTY_ROLLBACK_RESULT_STATE)

    const controller = new AbortController()
    void loadActionDetail(selectedActionId, controller.signal)
    return () => controller.abort()
  }, [deployForm.mode, loadActionDetail, selectedActionId])

  useEffect(() => {
    if (!selectedActionId || actionDetailTab !== 'versions' || versions.data || versions.loading) return undefined
    const controller = new AbortController()
    void loadVersions(selectedActionId, controller.signal)
    return () => controller.abort()
  }, [actionDetailTab, loadVersions, selectedActionId, versions.data])

  useEffect(() => {
    if (!selectedActionId || actionDetailTab !== 'activations' || activations.data || activations.loading) return undefined
    const controller = new AbortController()
    void loadActivations(selectedActionId, controller.signal)
    return () => controller.abort()
  }, [actionDetailTab, activations.data, loadActivations, selectedActionId])

  useEffect(() => {
    if (!selectedActionId || !selectedActivationId) {
      setActivationDetail(EMPTY_ACTIVATION_DETAIL)
      return undefined
    }

    const controller = new AbortController()
    setActivationDetail({ ...EMPTY_ACTIVATION_DETAIL, loading: true })

    void Promise.allSettled([
      requestConsoleSessionJson<FunctionActivation>(`/v1/functions/actions/${selectedActionId}/activations/${selectedActivationId}`, { signal: controller.signal }),
      requestConsoleSessionJson<FunctionActivationLog>(`/v1/functions/actions/${selectedActionId}/activations/${selectedActivationId}/logs`, { signal: controller.signal }),
      requestConsoleSessionJson<FunctionActivationResult>(`/v1/functions/actions/${selectedActionId}/activations/${selectedActivationId}/result`, { signal: controller.signal })
    ]).then((results) => {
      if (controller.signal.aborted) return
      const [activationResultData, logsResultData, payloadResultData] = results
      const next: FunctionActivationDetail = {
        activation: activationResultData.status === 'fulfilled' ? activationResultData.value : null,
        logs: logsResultData.status === 'fulfilled' ? logsResultData.value : null,
        result: payloadResultData.status === 'fulfilled' ? payloadResultData.value : null,
        activationError: activationResultData.status === 'rejected' ? getActivationUnavailableMessage(activationResultData.reason, 'No se pudo cargar la activación.') : null,
        logsError: logsResultData.status === 'rejected' ? getActivationLogsMessage(logsResultData.reason, 'No se pudieron cargar los registros.') : null,
        resultError: payloadResultData.status === 'rejected' ? getActivationUnavailableMessage(payloadResultData.reason, 'No se pudo cargar el resultado.') : null
      }
      setActivationDetail({ data: next, loading: false, error: null })
    })

    return () => controller.abort()
  }, [selectedActionId, selectedActivationId])

  useEffect(() => {
    if (deployForm.mode !== 'edit' || !actionDetail.data) return
    setDeployForm({
      mode: 'edit',
      actionName: actionDetail.data.actionName,
      runtime: actionDetail.data.execution?.runtime ?? '',
      entrypoint: actionDetail.data.execution?.entrypoint ?? '',
      inlineCode: actionDetail.data.source?.inlineCode ?? '',
      timeoutMs: actionDetail.data.execution?.limits?.timeoutMs ? String(actionDetail.data.execution.limits.timeoutMs) : '',
      memoryMb: actionDetail.data.execution?.limits?.memoryMb ? String(actionDetail.data.execution.limits.memoryMb) : ''
    })
  }, [actionDetail.data, deployForm.mode])

  const selectedAction = useMemo(
    () => inventory.data?.actions.find((item) => item.resourceId === selectedActionId) ?? null,
    [inventory.data, selectedActionId]
  )

  const effectiveAction = actionDetail.data ?? selectedAction
  const writeDisabledReason = getWriteDisabledReason(effectiveAction)
  const writeDisabled = writeDisabledReason !== null
  const writeDisabledReasonId = writeDisabledReason ? 'functions-write-disabled-reason' : undefined
  const deleteInFlight = destructiveOp.config?.operationId === 'delete-function' && destructiveOp.opState === 'confirming'
  const eligibleRollbackVersions = versions.data?.items.filter((item) => item.rollbackEligible) ?? []
  const invokeActivationId = invokeResult.data ? resolveActivationIdFromInvocation(invokeResult.data, activations.data) : null

  const functionSnippetContext = useMemo<SnippetContext | null>(() => {
    if (!effectiveAction) {
      return null
    }

    return {
      tenantId: effectiveAction.tenantId ?? activeTenantId,
      tenantSlug: null,
      workspaceId: effectiveAction.workspaceId ?? activeWorkspaceId,
      workspaceSlug: null,
      resourceName: effectiveAction.actionName,
      resourceHost: null,
      resourcePort: null,
      resourceExtraA: null,
      resourceExtraB: effectiveAction.httpExposure?.publicUrl ?? null,
      resourceState: effectiveAction.provisioning?.state ?? effectiveAction.status ?? null,
      externalAccessEnabled: effectiveAction.httpExposure?.enabled === true
    }
  }, [activeTenantId, activeWorkspaceId, effectiveAction])

  const handleActionTabKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, value: FunctionDetailTab) => {
    const currentIndex = FUNCTION_DETAIL_TABS.findIndex((item) => item.value === value)
    let nextIndex: number | null = null

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % FUNCTION_DETAIL_TABS.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + FUNCTION_DETAIL_TABS.length) % FUNCTION_DETAIL_TABS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = FUNCTION_DETAIL_TABS.length - 1

    if (nextIndex === null) return
    event.preventDefault()
    const nextTab = FUNCTION_DETAIL_TABS[nextIndex].value
    setActionDetailTab(nextTab)
    const focusNextTab = () => document.getElementById(getFunctionTabId(nextTab))?.focus()
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(focusNextTab)
    } else {
      setTimeout(focusNextTab, 0)
    }
  }, [])

  const handleInvoke = useCallback(async () => {
    if (!selectedActionId) return
    setInvokeResult({ data: null, loading: true, error: null })

    const parsedParameters = invokeForm.parametersJson.trim()
      ? parseJsonObject(invokeForm.parametersJson)
      : { ok: true as const, value: {} }
    if (!parsedParameters.ok) {
      const message = parsedParameters.error === 'Expected a JSON object'
        ? 'El payload debe ser un objeto JSON.'
        : 'El payload debe ser JSON válido.'
      setInvokeResult({ data: null, loading: false, error: message })
      return
    }

    const body: FunctionInvocationWriteRequest = {
      parameters: parsedParameters.value,
      responseMode: invokeForm.responseMode,
      idempotencyScope: 'request'
    }

    try {
      const data = await requestConsoleSessionJson<FunctionInvocationAccepted>(`/v1/functions/actions/${selectedActionId}/invocations`, {
        method: 'POST',
        body: body as never,
        headers: { 'Idempotency-Key': invokeIdempotencyKeyRef.current }
      })
      invokeIdempotencyKeyRef.current = buildIdempotencyKey()
      setInvokeResult({ data, loading: false, error: null })
      const refreshedActivations = await loadActivations(selectedActionId)
      const activationId = resolveActivationIdFromInvocation(data, refreshedActivations)
      if (activationId) {
        setSelectedActivationId(activationId)
        setActionDetailTab('activations')
      }
    } catch (error) {
      setInvokeResult({ data: null, loading: false, error: describeConsoleError(error, 'No se pudo invocar la función.') })
    }
  }, [invokeForm, loadActivations, selectedActionId])

  const handleDeploy = useCallback(async () => {
    if (!activeTenantId || !activeWorkspaceId) return
    if (!deployForm.actionName.trim() || !deployForm.runtime.trim() || !deployForm.entrypoint.trim()) {
      setDeployResult({ data: null, loading: false, error: 'Completa el nombre de acción, el entorno y el punto de entrada.' })
      return
    }
    if (!/^[a-z][a-z0-9-]{1,62}$/.test(deployForm.actionName.trim())) {
      setDeployResult({ data: null, loading: false, error: 'El nombre de la función debe cumplir el patrón requerido.' })
      return
    }

    const timeoutMs = deployForm.timeoutMs.trim() ? Number(deployForm.timeoutMs) : undefined
    const memoryMb = deployForm.memoryMb.trim() ? Number(deployForm.memoryMb) : undefined

    const body: FunctionActionWriteRequest = {
      tenantId: activeTenantId,
      workspaceId: activeWorkspaceId,
      actionName: deployForm.actionName.trim(),
      activationPolicy: actionDetail.data?.activationPolicy ?? { mode: 'workspace_default' },
      execution: {
        runtime: deployForm.runtime.trim(),
        entrypoint: deployForm.entrypoint.trim(),
        limits: {
          timeoutMs,
          memoryMb
        }
      },
      source: {
        kind: 'inline_code',
        inlineCode: deployForm.inlineCode,
        entryFile: 'index.js'
      }
    }

    setDeployResult({ data: null, loading: true, error: null })

    try {
      const url = deployForm.mode === 'create' ? '/v1/functions/actions' : `/v1/functions/actions/${selectedActionId}`
      const method = deployForm.mode === 'create' ? 'POST' : 'PATCH'
      const result = await requestConsoleSessionJson<GatewayMutationAccepted>(url, {
        method: method as 'POST',
        body: body as never,
        headers: { 'Idempotency-Key': deployIdempotencyKeyRef.current }
      })
      deployIdempotencyKeyRef.current = buildIdempotencyKey()
      setDeployResult({ data: result, loading: false, error: null })
      await loadInventory(activeWorkspaceId)
      const resourceId = result.resourceId ?? selectedActionId
      if (resourceId) {
        setSelectedActionId(resourceId)
        await loadActionDetail(resourceId)
      }
    } catch (error) {
      setDeployResult({ data: null, loading: false, error: describeConsoleError(error, 'No se pudo desplegar la función.') })
    }
  }, [actionDetail.data, activeTenantId, activeWorkspaceId, deployForm, loadActionDetail, loadInventory, selectedActionId])

  const handleRollback = useCallback(async () => {
    if (!selectedActionId || !rollbackTargetVersionId) return
    setRollbackResult({ data: null, loading: true, error: null })

    const body: FunctionRollbackWriteRequest = {
      versionId: rollbackTargetVersionId,
      reason: 'Reversión iniciada desde la consola'
    }

    try {
      const data = await requestConsoleSessionJson<FunctionRollbackAccepted>(`/v1/functions/actions/${selectedActionId}/rollback`, {
        method: 'POST',
        body: body as never,
        headers: { 'Idempotency-Key': rollbackIdempotencyKeyRef.current }
      })
      rollbackIdempotencyKeyRef.current = buildIdempotencyKey()
      setRollbackResult({ data, loading: false, error: null })
      await Promise.all([loadActionDetail(selectedActionId), loadVersions(selectedActionId)])
    } catch (error) {
      setRollbackResult({ data: null, loading: false, error: describeConsoleError(error, 'No se pudo solicitar la reversión.') })
    }
  }, [loadActionDetail, loadVersions, rollbackTargetVersionId, selectedActionId])

  const handleDeleteFunction = useCallback(async (action: FunctionAction) => {
    try {
      await deleteFunction(action.resourceId, deleteIdempotencyKeyRef.current)
      deleteIdempotencyKeyRef.current = buildIdempotencyKey()
    } catch (error) {
      const message = describeConsoleError(error, 'No se pudo eliminar la función.')
      // `preLocalized: true` tells useDestructiveOp's shared confirm-error mapping to trust this
      // already-safe message verbatim instead of re-deriving a more generic one (#743).
      throw Object.assign(error instanceof Error ? error : new Error(message), { message, preLocalized: true })
    }
  }, [])

  const openDeleteFunctionDialog = useCallback(() => {
    if (!effectiveAction || !activeWorkspaceId || !selectedActionId || writeDisabled) return
    const action = effectiveAction
    setDeleteFeedback(null)
    destructiveOp.openDialog({
      level: DESTRUCTIVE_OP_LEVELS['delete-function'],
      operationId: 'delete-function',
      resourceName: action.actionName,
      resourceType: 'función',
      resourceId: action.resourceId,
      impactDescription: 'Se eliminarán el registro de la función, su historial de versiones, sus activaciones y el servicio Knative asociado.',
      onConfirm: () => handleDeleteFunction(action),
      onSuccess: () => {
        setSelectedActionId(null)
        resetActionState()
        setInventory((current) => {
          if (!current.data) return current
          const actions = current.data.actions.filter((item) => item.resourceId !== action.resourceId)
          return {
            ...current,
            data: {
              ...current.data,
              actions,
              counts: current.data.counts ? { ...current.data.counts, actions: actions.length } : current.data.counts
            }
          }
        })
        setDeleteFeedback(`Función ${action.actionName} eliminada.`)
        void loadInventory(activeWorkspaceId)
      }
    })
  }, [activeWorkspaceId, destructiveOp, effectiveAction, handleDeleteFunction, loadInventory, resetActionState, selectedActionId, writeDisabled])

  if (!activeTenantId) {
    return (
      <Alert variant="destructive">
        Selecciona una organización para continuar.
      </Alert>
    )
  }
  if (!activeWorkspaceId) {
    return <WorkspaceRequiredState description="Selecciona un área de trabajo para ver las funciones." />
  }

  return (
    <section className="space-y-6" aria-labelledby="functions-admin-title">
      <header className={pagePanelClassName}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0 space-y-2">
            <Badge variant="outline">Funciones</Badge>
            <div>
              <h1 id="functions-admin-title" className="text-2xl font-semibold tracking-tight text-foreground">Funciones: administrar</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                Inventario, detalle operativo, activaciones, invocación y despliegue del entorno serverless.
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Para una prueba directa con JSON sin historial operativo, usa{' '}
                <Link
                  className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  to="/console/functions/data"
                >
                  Funciones: despliegue rápido
                </Link>.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={openCreateMode} type="button" variant="default">
              <Rocket className="h-4 w-4" aria-hidden="true" />
              Desplegar función
            </Button>
          </div>
        </div>
      </header>

      {deleteFeedback ? (
        <Alert variant="success" className="text-foreground">
          <AlertTitle>Función eliminada</AlertTitle>
          <p>{deleteFeedback}</p>
        </Alert>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(320px,420px)_1fr] xl:items-start">
        <section className={cn(pagePanelClassName, 'space-y-4')}>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-foreground">Inventario</h2>
              {inventory.data?.quotaStatus ? <Badge variant="outline">Cuota {formatValue(inventory.data.quotaStatus.remaining)}/{formatValue(inventory.data.quotaStatus.limit)}</Badge> : null}
            </div>
            {inventory.data?.counts ? (
              <KeyValueGrid items={[
                { label: 'Acciones', value: inventory.data.counts.actions },
                { label: 'Paquetes', value: inventory.data.counts.packages },
                { label: 'Disparadores', value: inventory.data.counts.triggers },
                { label: 'Exposiciones HTTP', value: inventory.data.counts.httpExposures }
              ]} />
            ) : null}
            {inventory.loading ? <p className={loadingTextClassName}>Cargando inventario…</p> : null}
            {!inventory.loading && inventory.error ? (
              <Alert variant="destructive" className="space-y-3 text-foreground">
                <p>{inventory.error}</p>
                <Button onClick={() => void loadInventory(activeWorkspaceId)} type="button" variant="outline">Reintentar</Button>
              </Alert>
            ) : null}
            {!inventory.loading && !inventory.error && (!inventory.data || inventory.data.actions.length === 0) ? <p className={emptyStateClassName}>No hay funciones en esta área de trabajo.</p> : null}
            {!inventory.loading && !inventory.error && inventory.data?.actions.length ? (
              <div className="space-y-2">
                {inventory.data.actions.map((item) => {
                  const selected = item.resourceId === selectedActionId
                  return (
                    <button
                      className={cn(rowButtonClassName, selected && 'border-primary/70 bg-primary/10')}
                      key={item.resourceId}
                      onClick={() => {
                        setDeployForm((current) => ({ ...current, mode: 'edit' }))
                        setSelectedActionId(item.resourceId)
                      }}
                      type="button"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <strong className="min-w-0 truncate text-sm font-semibold text-foreground">{item.actionName}</strong>
                        <FunctionStatusBadge value={item.provisioning?.state ?? item.status} />
                      </div>
                      <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">Entorno: {item.execution?.runtime ?? '—'} · Versión: {item.activeVersionId ?? '—'}</p>
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        </section>

        <section className={cn(pagePanelClassName, 'space-y-4')}>
          {!selectedActionId && deployForm.mode !== 'create' ? (
            <div className={emptyStateClassName}>
              <h2 className="text-base font-semibold text-foreground">Detalle de la función</h2>
              <p className="text-sm text-muted-foreground">Selecciona una función del inventario para revisar su configuración, activaciones y operaciones disponibles.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-foreground">{deployForm.mode === 'create' && !selectedActionId ? 'Nueva función' : effectiveAction?.actionName ?? 'Función seleccionada'}</h2>
                  {effectiveAction ? <FunctionStatusBadge value={effectiveAction.provisioning?.state ?? effectiveAction.status} /> : null}
                  {effectiveAction?.provisioning?.state ? <Badge variant="outline">Aprovisionamiento: {formatEnumLabel(effectiveAction.provisioning.state)}</Badge> : null}
                </div>
                {effectiveAction && selectedActionId ? (
                  <div className="flex w-full flex-col items-stretch gap-2 sm:w-72">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      onClick={openDeleteFunctionDialog}
                      disabled={writeDisabled || deleteInFlight}
                      aria-busy={deleteInFlight}
                      aria-describedby={writeDisabledReasonId}
                      aria-label={`Eliminar función ${effectiveAction.actionName}${deleteInFlight ? ' en curso' : ''}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      {deleteInFlight ? 'Eliminando…' : 'Eliminar función'}
                    </Button>
                    {writeDisabledReason ? (
                      <WriteDisabledNotice id={writeDisabledReasonId} reason={writeDisabledReason} />
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div role="tablist" aria-label="Operaciones de función" className="flex w-full gap-1 overflow-x-auto rounded-2xl border border-border/70 bg-background/50 p-1">
                {FUNCTION_DETAIL_TABS.map(({ value, label }) => (
                  <Button
                    key={value}
                    type="button"
                    role="tab"
                    id={getFunctionTabId(value)}
                    aria-controls={getFunctionPanelId(value)}
                    aria-selected={actionDetailTab === value}
                    tabIndex={actionDetailTab === value ? 0 : -1}
                    onClick={() => setActionDetailTab(value)}
                    onKeyDown={(event) => handleActionTabKeyDown(event, value)}
                    variant={actionDetailTab === value ? 'default' : 'ghost'}
                    size="sm"
                    className="flex-none"
                  >
                    {label}
                  </Button>
                ))}
              </div>

              <section
                role="tabpanel"
                id={getFunctionPanelId(actionDetailTab)}
                aria-labelledby={getFunctionTabId(actionDetailTab)}
                tabIndex={0}
                className="outline-none"
              >
              {actionDetailTab === 'detail' ? (
                <div className="space-y-4">
                  {selectedActionId && actionDetail.loading ? <p className={loadingTextClassName}>Cargando detalle…</p> : null}
                  {selectedActionId && !actionDetail.loading && actionDetail.error ? <Alert variant="destructive">{actionDetail.error}</Alert> : null}
                  {effectiveAction ? (
                    <>
                      <section className="space-y-3">
                        <h3 className="font-semibold">Identificación</h3>
                        <KeyValueGrid items={[
                          { label: 'Nombre de acción', value: effectiveAction.actionName },
                          { label: 'ID de recurso', value: effectiveAction.resourceId, mono: true },
                          { label: 'Paquete', value: effectiveAction.packageName },
                          { label: 'Namespace', value: effectiveAction.namespaceName },
                          { label: 'Versión activa', value: effectiveAction.activeVersionId, mono: true },
                          { label: 'Digest de despliegue', value: effectiveAction.deploymentDigest, mono: true }
                        ]} />
                      </section>
                      <section className="space-y-3">
                        <h3 className="font-semibold">Ejecución</h3>
                        <KeyValueGrid items={[
                          { label: 'Entorno', value: effectiveAction.execution?.runtime },
                          { label: 'Punto de entrada', value: effectiveAction.execution?.entrypoint },
                          { label: 'Tiempo de espera (ms)', value: effectiveAction.execution?.limits?.timeoutMs },
                          { label: 'Memoria (MB)', value: effectiveAction.execution?.limits?.memoryMb },
                          { label: 'Invocaciones concurrentes', value: effectiveAction.execution?.limits?.concurrentInvocations },
                          { label: 'Retención de activaciones', value: effectiveAction.activationPolicy?.retentionDays }
                        ]} />
                      </section>
                      {functionSnippetContext ? <ConnectionSnippets resourceType="serverless-function" context={functionSnippetContext} /> : null}
                      <section className="space-y-3">
                        <h3 className="font-semibold">Configuración avanzada</h3>
                        <KeyValueGrid items={[
                          { label: 'Tipo de fuente', value: effectiveAction.source?.kind },
                          { label: 'HTTP habilitado', value: effectiveAction.httpExposure?.enabled },
                          { label: 'URL HTTP', value: effectiveAction.httpExposure?.publicUrl },
                          { label: 'Autenticación HTTP', value: effectiveAction.httpExposure?.authPolicy },
                          { label: 'Estado de aprovisionamiento', value: effectiveAction.provisioning?.state },
                          { label: 'Clase de fallo', value: effectiveAction.provisioning?.failureClass }
                        ]} />
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div>
                            <h4 className="mb-2 text-sm font-medium">Entorno</h4>
                            <ConsoleBlock>{formatJson(effectiveAction.execution?.environment)}</ConsoleBlock>
                          </div>
                          <div>
                            <h4 className="mb-2 text-sm font-medium">Parámetros</h4>
                            <ConsoleBlock>{formatJson(effectiveAction.execution?.parameters)}</ConsoleBlock>
                          </div>
                        </div>
                      </section>
                      <section className="space-y-3">
                        <h3 className="font-semibold">Secretos y timestamps</h3>
                        <KeyValueGrid items={[
                          { label: 'Referencias de secreto', value: effectiveAction.secretReferences?.map((item) => item.secretName).join(', ') || '—' },
                          { label: 'Creada en', value: effectiveAction.timestamps?.createdAt },
                          { label: 'Actualizada en', value: effectiveAction.timestamps?.updatedAt },
                          { label: 'Reversión disponible', value: effectiveAction.rollbackAvailable }
                        ]} />
                      </section>
                    </>
                  ) : null}
                </div>
              ) : null}

              {actionDetailTab === 'versions' ? (
                <div className="space-y-4">
                  {versions.loading ? <p className={loadingTextClassName}>Cargando versiones…</p> : null}
                  {!versions.loading && versions.error ? (
                    <Alert variant="destructive" className="space-y-2 text-foreground">
                      <p>{versions.error}</p>
                      {selectedActionId ? <Button onClick={() => void loadVersions(selectedActionId)} type="button" variant="outline">Reintentar</Button> : null}
                    </Alert>
                  ) : null}
                  {!versions.loading && !versions.error && versions.data?.items.length === 0 ? <p className={emptyStateClassName}>No hay versiones anteriores disponibles.</p> : null}
                  {!versions.loading && !versions.error && versions.data?.items.length ? (
                    <>
                      <div className="overflow-x-auto rounded-2xl border border-border/70 bg-background/40">
                        <table className="min-w-full text-left text-sm">
                          <thead className="bg-muted/30">
                            <tr className="border-b border-border text-muted-foreground">
                              <th className="px-3 py-2 font-medium">Versión</th>
                              <th className="px-3 py-2 font-medium">ID de versión</th>
                              <th className="px-3 py-2 font-medium">Estado</th>
                              <th className="px-3 py-2 font-medium">Origen</th>
                              <th className="px-3 py-2 font-medium">Creada en</th>
                            </tr>
                          </thead>
                          <tbody>
                            {versions.data.items.map((item) => (
                              <tr className="border-b border-border/60 last:border-b-0" key={item.versionId}>
                                <td className="px-3 py-3">
                                  <label className="flex items-center gap-2">
                                    <input checked={rollbackTargetVersionId === item.versionId} disabled={!item.rollbackEligible || writeDisabled} name="rollback-version" onChange={() => setRollbackTargetVersionId(item.versionId)} type="radio" />
                                    <span>{formatValue(item.versionNumber)}</span>
                                  </label>
                                </td>
                                <td className="break-all px-3 py-3 font-mono text-xs">{item.versionId}</td>
                                <td className="px-3 py-3"><FunctionStatusBadge value={item.status} /></td>
                                <td className="px-3 py-3">{formatEnumLabel(item.originType)}</td>
                                <td className="px-3 py-3 text-muted-foreground">{formatValue(item.timestamps?.createdAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="space-y-2">
                        <Button
                          disabled={writeDisabled || eligibleRollbackVersions.length === 0 || !rollbackTargetVersionId || rollbackResult.loading}
                          onClick={() => void handleRollback()}
                          type="button"
                          aria-describedby={writeDisabledReasonId}
                        >
                          <RotateCcw className="h-4 w-4" aria-hidden="true" />
                          {rollbackResult.loading ? 'Solicitando reversión…' : 'Revertir'}
                        </Button>
                        {eligibleRollbackVersions.length === 0 ? <p className="text-sm text-muted-foreground">No hay versiones anteriores disponibles para revertir.</p> : null}
                        {rollbackResult.error ? <Alert variant="destructive">{rollbackResult.error}</Alert> : null}
                        {rollbackResult.data ? (
                          <Alert className="text-foreground">
                            <AlertTitle>Reversión {rollbackResult.data.status}</AlertTitle>
                            <p className="mt-1 font-mono text-xs">{rollbackResult.data.requestedVersionId}</p>
                          </Alert>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}

              {actionDetailTab === 'activations' ? (
                <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_1fr]">
                  <div className="space-y-3">
                    {activations.loading ? <p className={loadingTextClassName}>Cargando activaciones…</p> : null}
                    {!activations.loading && activations.error ? (
                      <Alert variant="destructive" className="space-y-2 text-foreground">
                        <p>{activations.error}</p>
                        {selectedActionId ? <Button onClick={() => void loadActivations(selectedActionId)} type="button" variant="outline">Reintentar</Button> : null}
                      </Alert>
                    ) : null}
                    {!activations.loading && !activations.error && activations.data?.items.length === 0 ? <p className={emptyStateClassName}>Esta función no tiene activaciones registradas.</p> : null}
                    {activations.data?.items.map((item) => (
                      <button className={cn(rowButtonClassName, selectedActivationId === item.activationId && 'border-primary/70 bg-primary/10')} key={item.activationId} onClick={() => setSelectedActivationId(item.activationId)} type="button">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <FunctionStatusBadge value={item.status} />
                          <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">{item.activationId}</span>
                        </div>
                        <p className="mt-2 text-sm text-foreground">{item.durationMs} ms · {item.triggerKind}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{formatValue(item.startedAt)}</p>
                      </button>
                    ))}
                  </div>
                  <div className={cn(nestedPanelClassName, 'space-y-3')}>
                    {!selectedActivationId ? <p className={loadingTextClassName}>Selecciona una activación para ver metadatos, registros y resultado.</p> : null}
                    {activationDetail.loading ? <p className={loadingTextClassName}>Cargando detalle de activación…</p> : null}
                    {activationDetail.data.activation ? (
                      <KeyValueGrid items={[
                        { label: 'ID de activación', value: activationDetail.data.activation.activationId, mono: true },
                        { label: 'ID de recurso', value: activationDetail.data.activation.resourceId, mono: true },
                        { label: 'Estado', value: <FunctionStatusBadge value={activationDetail.data.activation.status} /> },
                        { label: 'Iniciada en', value: activationDetail.data.activation.startedAt },
                        { label: 'Finalizada en', value: activationDetail.data.activation.finishedAt },
                        { label: 'Duración (ms)', value: activationDetail.data.activation.durationMs },
                        { label: 'Código de estado', value: activationDetail.data.activation.statusCode },
                        { label: 'Tipo de disparador', value: activationDetail.data.activation.triggerKind },
                        { label: 'Memoria (MB)', value: activationDetail.data.activation.memoryMb },
                        { label: 'ID de invocación', value: activationDetail.data.activation.invocationId, mono: true },
                        { label: 'Retención (días)', value: activationDetail.data.activation.policy?.retentionDays }
                      ]} />
                    ) : null}
                    {activationDetail.data.activationError ? <Alert variant="destructive">{activationDetail.data.activationError}</Alert> : null}
                    <section className="space-y-2">
                      <h3 className="font-semibold">Registros</h3>
                      {activationDetail.data.logsError ? <Alert variant="destructive">{activationDetail.data.logsError}</Alert> : null}
                      {!activationDetail.data.logsError && activationDetail.data.logs?.truncated ? (
                        <Alert className="border-amber-500/40 bg-amber-500/10 text-foreground">
                          Los registros están truncados. Se muestra el contenido disponible.
                        </Alert>
                      ) : null}
                      {!activationDetail.data.logsError && activationDetail.data.activation?.status === 'running' && !activationDetail.data.logs ? <p>La activación sigue en curso. Los registros pueden no estar disponibles aún.</p> : null}
                      {!activationDetail.data.logsError && activationDetail.data.logs && activationDetail.data.logs.lines.length === 0 ? <p>No hay registros disponibles para esta activación.</p> : null}
                      {!activationDetail.data.logsError && activationDetail.data.logs && activationDetail.data.logs.lines.length > 0 ? (
                        <ConsoleBlock testId="functions-activation-logs">{activationDetail.data.logs.lines.join('\n')}</ConsoleBlock>
                      ) : null}
                    </section>
                    <section className="space-y-2">
                      <h3 className="font-semibold">Resultado</h3>
                      {activationDetail.data.resultError ? <Alert variant="destructive">{activationDetail.data.resultError}</Alert> : null}
                      {!activationDetail.data.resultError && activationDetail.data.result ? (() => {
                        const res = activationDetail.data.result
                        const ct = res.contentType ?? ''
                        if (ct.includes('octet-stream')) {
                          return <p>El resultado no se puede mostrar en texto.</p>
                        }
                        if (res.result === null || res.result === undefined) {
                          return <p>Sin resultado disponible.</p>
                        }
                        if (ct.includes('text/plain') && typeof res.result === 'string') {
                          return <ConsoleBlock testId="functions-activation-result">{res.result}</ConsoleBlock>
                        }
                        return (
                          <ConsoleBlock testId="functions-activation-result">
                            {typeof res.result === 'string' ? res.result : prettyJson(res.result)}
                          </ConsoleBlock>
                        )
                      })() : null}
                      {!activationDetail.data.resultError && !activationDetail.data.result && activationDetail.data.activation?.status === 'running' && selectedActivationId && !activationDetail.loading ? (
                        <p>La activación sigue en curso. El resultado puede no estar disponible aún.</p>
                      ) : null}
                      {!activationDetail.data.resultError && !activationDetail.data.result && activationDetail.data.activation?.status !== 'running' && selectedActivationId && !activationDetail.loading ? (
                        <p>Sin resultado disponible.</p>
                      ) : null}
                    </section>
                  </div>
                </div>
              ) : null}

              {actionDetailTab === 'triggers' ? (
                <div className="space-y-4">
                  {!effectiveAction?.kafkaTriggers?.length && !effectiveAction?.cronTriggers?.length && !effectiveAction?.storageTriggers?.length ? <p className={emptyStateClassName}>No hay asociaciones de disparadores configuradas para esta función.</p> : null}
                  {effectiveAction?.kafkaTriggers?.length ? (
                    <section className="space-y-2">
                      <h3 className="font-semibold">Kafka</h3>
                      <div className="space-y-2">
                        {effectiveAction.kafkaTriggers.map((item) => (
                          <div className={cn(nestedPanelClassName, 'text-sm leading-6')} key={item.triggerId ?? item.topicRef}>
                            <span className="font-mono text-xs text-foreground">{item.topicRef ?? item.triggerId}</span>
                            <span className="text-muted-foreground"> · {formatEnumLabel(item.deliveryMode)} · {formatEnumLabel(item.status)}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}
                  {effectiveAction?.cronTriggers?.length ? (
                    <section className="space-y-2">
                      <h3 className="font-semibold">Cron</h3>
                      <div className="space-y-2">
                        {effectiveAction.cronTriggers.map((item) => (
                          <div className={cn(nestedPanelClassName, 'text-sm leading-6')} key={item.triggerId ?? item.schedule}>
                            <span className="font-mono text-xs text-foreground">{item.schedule ?? item.triggerId}</span>
                            <span className="text-muted-foreground"> · {formatValue(item.timezone)} · {formatEnumLabel(item.status)}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}
                  {effectiveAction?.storageTriggers?.length ? (
                    <section className="space-y-2">
                      <h3 className="font-semibold">Almacenamiento</h3>
                      <div className="space-y-2">
                        {effectiveAction.storageTriggers.map((item) => (
                          <div className={cn(nestedPanelClassName, 'text-sm leading-6')} key={item.triggerId ?? item.bucketRef}>
                            <span className="font-mono text-xs text-foreground">{item.bucketRef ?? item.triggerId}</span>
                            <span className="text-muted-foreground"> · {item.eventTypes?.join(', ') || '—'} · {formatEnumLabel(item.status)}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              ) : null}

              {actionDetailTab === 'invoke' ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="functions-invoke-payload">Contenido JSON</Label>
                    <Textarea
                      autoCapitalize="off"
                      autoComplete="off"
                      autoCorrect="off"
                      className="min-h-36 font-mono text-xs leading-5"
                      id="functions-invoke-payload"
                      onChange={(event) => setInvokeForm((current) => ({ ...current, parametersJson: event.target.value }))}
                      spellCheck={false}
                      style={{ tabSize: 2 }}
                      value={invokeForm.parametersJson}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="functions-response-mode">Modo de respuesta</Label>
                    <Select
                      id="functions-response-mode"
                      onChange={(event) => setInvokeForm((current) => ({ ...current, responseMode: event.target.value as 'accepted' | 'wait_for_result' }))}
                      value={invokeForm.responseMode}
                    >
                      <option value="accepted">accepted</option>
                      <option value="wait_for_result">wait_for_result</option>
                    </Select>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      disabled={!selectedActionId || writeDisabled || invokeResult.loading}
                      onClick={() => void handleInvoke()}
                      type="button"
                      aria-describedby={writeDisabledReasonId}
                    >
                      <Play className="h-4 w-4" aria-hidden="true" />
                      {invokeResult.loading ? 'Invocando…' : 'Invocar'}
                    </Button>
                  </div>
                  {writeDisabledReason ? <WriteDisabledNotice reason={writeDisabledReason} className="max-w-xl" /> : null}
                  {invokeResult.error ? (
                    <Alert variant="destructive" className="text-foreground">
                      <p>{invokeResult.error}</p>
                      {invokeResult.error.includes('quota') || invokeResult.error.includes('429') ? <p className="mt-2 text-muted-foreground">Revisa límites o aplicación de límites antes de reintentar.</p> : null}
                    </Alert>
                  ) : null}
                  {invokeResult.data ? (
                    <Alert className="space-y-3 text-foreground">
                      <div className="flex flex-wrap items-center gap-2">
                        <AlertTitle>Invocación aceptada</AlertTitle>
                        <FunctionStatusBadge value={invokeResult.data.status} />
                      </div>
                      <div className="grid gap-2 text-sm sm:grid-cols-2">
                        <p><strong>ID de invocación:</strong> <span className="font-mono text-xs">{invokeResult.data.invocationId}</span></p>
                        {invokeActivationId ? <p><strong>Activación:</strong> <span className="font-mono text-xs">{invokeActivationId}</span></p> : null}
                        <p><strong>Aceptada en:</strong> {invokeResult.data.acceptedAt}</p>
                      </div>
                      {invokeActivationId ? (
                        <Button
                          onClick={() => {
                            setSelectedActivationId(invokeActivationId)
                            setActionDetailTab('activations')
                          }}
                          type="button"
                          variant="outline"
                        >
                          Ver activación
                        </Button>
                      ) : null}
                      {invokeResult.data.result !== undefined ? (
                        <ConsoleBlock testId="functions-invoke-inline-result">{formatResultForDisplay(invokeResult.data.result)}</ConsoleBlock>
                      ) : null}
                      {invokeResult.data.logs?.length ? (
                        <ConsoleBlock testId="functions-invoke-inline-logs">{invokeResult.data.logs.join('\n')}</ConsoleBlock>
                      ) : null}
                    </Alert>
                  ) : null}
                </div>
              ) : null}

              {actionDetailTab === 'deploy' ? (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="functions-action-name">Nombre de acción</Label>
                      <Input
                        className="font-mono"
                        disabled={deployForm.mode === 'edit'}
                        id="functions-action-name"
                        onChange={(event) => setDeployForm((current) => ({ ...current, actionName: event.target.value }))}
                        type="text"
                        value={deployForm.actionName}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="functions-runtime">Entorno</Label>
                      <Select
                        id="functions-runtime"
                        onChange={(event) => setDeployForm((current) => ({ ...current, runtime: event.target.value }))}
                        value={deployForm.runtime}
                      >
                        <option value="">Selecciona un entorno</option>
                        {runtimeOptionsFor(deployForm.runtime).map((runtime) => (
                          <option key={runtime} value={runtime}>{runtime}</option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="functions-entrypoint">Punto de entrada</Label>
                      <Input
                        className="font-mono"
                        id="functions-entrypoint"
                        onChange={(event) => setDeployForm((current) => ({ ...current, entrypoint: event.target.value }))}
                        type="text"
                        value={deployForm.entrypoint}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="functions-timeout-ms">Tiempo de espera (ms)</Label>
                      <Input
                        id="functions-timeout-ms"
                        onChange={(event) => setDeployForm((current) => ({ ...current, timeoutMs: event.target.value }))}
                        type="number"
                        value={deployForm.timeoutMs}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="functions-memory-mb">Memoria (MB)</Label>
                      <Input
                        id="functions-memory-mb"
                        onChange={(event) => setDeployForm((current) => ({ ...current, memoryMb: event.target.value }))}
                        type="number"
                        value={deployForm.memoryMb}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="functions-inline-code">Código inline</Label>
                    <Textarea
                      autoCapitalize="off"
                      autoComplete="off"
                      autoCorrect="off"
                      className="min-h-48 font-mono text-xs leading-5"
                      id="functions-inline-code"
                      onChange={(event) => setDeployForm((current) => ({ ...current, inlineCode: event.target.value }))}
                      spellCheck={false}
                      style={{ tabSize: 2 }}
                      value={deployForm.inlineCode}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      disabled={writeDisabled || deployResult.loading}
                      onClick={() => void handleDeploy()}
                      type="button"
                      aria-describedby={writeDisabledReasonId}
                    >
                      <Rocket className="h-4 w-4" aria-hidden="true" />
                      {deployResult.loading ? 'Desplegando…' : deployForm.mode === 'create' ? 'Crear función' : 'Actualizar función'}
                    </Button>
                  </div>
                  {writeDisabledReason && deployForm.mode === 'edit' ? <WriteDisabledNotice reason={writeDisabledReason} className="max-w-xl" /> : null}
                  {deployResult.error ? <Alert variant="destructive">{deployResult.error}</Alert> : null}
                  {deployResult.data ? (
                    <Alert className="space-y-2 text-foreground">
                      <div className="flex flex-wrap items-center gap-2">
                        <AlertTitle>Solicitud aceptada</AlertTitle>
                        {'status' in deployResult.data ? <FunctionStatusBadge value={deployResult.data.status} /> : null}
                      </div>
                      {deployResult.data.resourceId ? <p>Recurso <span className="font-mono text-xs">{deployResult.data.resourceId}</span>.</p> : null}
                    </Alert>
                  ) : null}
                </div>
              ) : null}
              </section>
            </div>
          )}
        </section>
      </section>

      <DestructiveConfirmationDialog
        open={destructiveOp.isOpen}
        config={destructiveOp.config}
        opState={destructiveOp.opState}
        confirmError={destructiveOp.confirmError}
        onConfirm={() => void destructiveOp.handleConfirm()}
        onCancel={destructiveOp.handleCancel}
      />
    </section>
  )
}
