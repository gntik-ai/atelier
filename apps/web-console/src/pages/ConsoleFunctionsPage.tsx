import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PublishFunctionWizard } from '@/components/console/wizards/PublishFunctionWizard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConsoleContext } from '@/lib/console-context'
import { requestConsoleSessionJson } from '@/lib/console-session'

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
  page?: { total?: number; after?: string }
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

type GatewayMutationAccepted = {
  requestId?: string
  correlationId?: string
  resourceId?: string
  status?: string
  acceptedAt?: string
}

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

function getApiErrorMessage(rawError: unknown, fallback: string): string {
  if (rawError && typeof rawError === 'object') {
    const maybeMessage = 'message' in rawError ? rawError.message : undefined
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) return maybeMessage
    const maybeBody = 'body' in rawError ? rawError.body : undefined
    if (maybeBody && typeof maybeBody === 'object' && maybeBody !== null && 'message' in maybeBody) {
      const message = (maybeBody as { message?: unknown }).message
      if (typeof message === 'string' && message.trim()) return message
    }
  }
  return fallback
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
  return JSON.stringify(value, null, 2)
}

function statusTone(value?: string | null): 'default' | 'secondary' | 'destructive' | 'outline' {
  const normalized = value?.toLowerCase()
  if (!normalized) return 'outline'
  if (['active', 'succeeded', 'accepted', 'queued'].includes(normalized)) return 'default'
  if (['failed', 'invalid', 'degraded', 'timed_out', 'cancelled'].includes(normalized)) return 'destructive'
  if (['provisioning', 'deploying', 'running'].includes(normalized)) return 'secondary'
  return 'outline'
}

function buildIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `fn_${Date.now()}`
}

function canWrite(action: FunctionAction | null): boolean {
  const state = action?.provisioning?.state?.toLowerCase()
  return !(state === 'provisioning' || state === 'degraded' || state === 'suspended')
}

function KeyValueGrid({ items }: { items: Array<{ label: string; value: unknown }> }) {
  return (
    <dl className="grid gap-3 md:grid-cols-2">
      {items.map((item) => (
        <div className="rounded-lg border border-border p-3" key={item.label}>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 text-sm">{formatValue(item.value)}</dd>
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
  const [invokeForm, setInvokeForm] = useState<{ parametersJson: string; responseMode: 'accepted' | 'wait_for_result' }>({ parametersJson: '{}', responseMode: 'accepted' })
  const [invokeResult, setInvokeResult] = useState<SectionState<FunctionInvocationAccepted | null>>(EMPTY_INVOKE_RESULT_STATE)
  const [deployForm, setDeployForm] = useState<DeployFormState>(EMPTY_DEPLOY_FORM)
  const [deployResult, setDeployResult] = useState<SectionState<FunctionAction | GatewayMutationAccepted | null>>(EMPTY_DEPLOY_RESULT_STATE)
  const [rollbackTargetVersionId, setRollbackTargetVersionId] = useState<string | null>(null)
  const [rollbackResult, setRollbackResult] = useState<SectionState<FunctionRollbackAccepted | null>>(EMPTY_ROLLBACK_RESULT_STATE)
  const [publishWizardOpen, setPublishWizardOpen] = useState(false)
  const invokeIdempotencyKeyRef = useRef(buildIdempotencyKey())
  const deployIdempotencyKeyRef = useRef(buildIdempotencyKey())
  const rollbackIdempotencyKeyRef = useRef(buildIdempotencyKey())

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
        setInventory({ data: null, loading: false, error: getApiErrorMessage(fallbackError, getApiErrorMessage(error, 'No se pudo cargar el inventario de funciones.')) })
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
      setActionDetail({ data: null, loading: false, error: getApiErrorMessage(error, 'No se pudo cargar el detalle de la función.') })
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
      setVersions({ data: null, loading: false, error: getApiErrorMessage(error, 'No se pudo cargar el historial de versiones.') })
    }
  }, [])

  const loadActivations = useCallback(async (resourceId: string, signal?: AbortSignal) => {
    setActivations((current) => ({ ...current, loading: true, error: null }))
    try {
      const data = await requestConsoleSessionJson<FunctionActivationCollection>(`/v1/functions/actions/${resourceId}/activations?page[size]=50`, { signal })
      setActivations({ data, loading: false, error: null })
    } catch (error) {
      if (isAbortError(error)) return
      setActivations({ data: null, loading: false, error: getApiErrorMessage(error, 'No se pudo cargar las activaciones.') })
    }
  }, [])

  const openCreateMode = useCallback(() => {
    setSelectedActionId(null)
    resetActionState()
    setActionDetailTab('deploy')
    setDeployForm({ ...EMPTY_DEPLOY_FORM, mode: 'create' })
  }, [resetActionState])

  useEffect(() => {
    setInventory(EMPTY_INVENTORY_STATE)
    setSelectedActionId(null)
    resetActionState()

    if (!activeWorkspaceId) return undefined

    const controller = new AbortController()
    void loadInventory(activeWorkspaceId, controller.signal)
    return () => controller.abort()
  }, [activeTenantId, activeWorkspaceId, loadInventory, resetActionState])

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
        activationError: activationResultData.status === 'rejected' ? getApiErrorMessage(activationResultData.reason, 'No se pudo cargar la activación.') : null,
        logsError: logsResultData.status === 'rejected' ? getApiErrorMessage(logsResultData.reason, 'No se pudieron cargar los logs.') : null,
        resultError: payloadResultData.status === 'rejected' ? getApiErrorMessage(payloadResultData.reason, 'No se pudo cargar el resultado.') : null
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
  const writeDisabled = !canWrite(effectiveAction)
  const eligibleRollbackVersions = versions.data?.items.filter((item) => item.rollbackEligible) ?? []

  const handleInvoke = useCallback(async () => {
    if (!selectedActionId) return
    setInvokeResult({ data: null, loading: true, error: null })

    let parameters: Record<string, unknown> = {}
    try {
      parameters = invokeForm.parametersJson.trim() ? JSON.parse(invokeForm.parametersJson) as Record<string, unknown> : {}
    } catch {
      setInvokeResult({ data: null, loading: false, error: 'El payload debe ser JSON válido.' })
      return
    }

    const body: FunctionInvocationWriteRequest = {
      parameters,
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
    } catch (error) {
      setInvokeResult({ data: null, loading: false, error: getApiErrorMessage(error, 'No se pudo invocar la función.') })
    }
  }, [invokeForm, selectedActionId])

  const handleDeploy = useCallback(async () => {
    if (!activeTenantId || !activeWorkspaceId) return
    if (!deployForm.actionName.trim() || !deployForm.runtime.trim() || !deployForm.entrypoint.trim()) {
      setDeployResult({ data: null, loading: false, error: 'Completa action name, runtime y entrypoint.' })
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
      setDeployResult({ data: null, loading: false, error: getApiErrorMessage(error, 'No se pudo desplegar la función.') })
    }
  }, [actionDetail.data, activeTenantId, activeWorkspaceId, deployForm, loadActionDetail, loadInventory, selectedActionId])

  const handleRollback = useCallback(async () => {
    if (!selectedActionId || !rollbackTargetVersionId) return
    setRollbackResult({ data: null, loading: true, error: null })

    const body: FunctionRollbackWriteRequest = {
      versionId: rollbackTargetVersionId,
      reason: 'Console-initiated rollback'
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
      setRollbackResult({ data: null, loading: false, error: getApiErrorMessage(error, 'No se pudo solicitar el rollback.') })
    }
  }, [loadActionDetail, loadVersions, rollbackTargetVersionId, selectedActionId])

  if (!activeTenantId) return <p role="alert">Selecciona un tenant para continuar.</p>
  if (!activeWorkspaceId) return <p role="alert">Selecciona un workspace para ver las funciones.</p>

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <Badge variant="outline">Functions</Badge>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Consola de funciones</h1>
            <p className="text-sm text-muted-foreground">Inventario, detalle operativo, activaciones, invocación y despliegue del runtime serverless.</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setPublishWizardOpen(true)} type="button" variant="default">Publicar función</Button>
            <Button onClick={openCreateMode} type="button" variant="outline">Deploy nueva función</Button>
          </div>
        </div>
      </header>

      {publishWizardOpen ? <PublishFunctionWizard open={publishWizardOpen} onOpenChange={setPublishWizardOpen} /> : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(320px,420px)_1fr]">
        <section className="space-y-4 rounded-xl border border-border p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Inventario</h2>
              {inventory.data?.quotaStatus ? <Badge variant="outline">Quota {formatValue(inventory.data.quotaStatus.remaining)}/{formatValue(inventory.data.quotaStatus.limit)}</Badge> : null}
            </div>
            {inventory.data?.counts ? (
              <KeyValueGrid items={[
                { label: 'Actions', value: inventory.data.counts.actions },
                { label: 'Packages', value: inventory.data.counts.packages },
                { label: 'Triggers', value: inventory.data.counts.triggers },
                { label: 'HTTP exposures', value: inventory.data.counts.httpExposures }
              ]} />
            ) : null}
            {inventory.loading ? <p>Cargando inventario…</p> : null}
            {!inventory.loading && inventory.error ? (
              <div className="space-y-3" role="alert">
                <p>{inventory.error}</p>
                <Button onClick={() => void loadInventory(activeWorkspaceId)} type="button" variant="outline">Reintentar</Button>
              </div>
            ) : null}
            {!inventory.loading && !inventory.error && (!inventory.data || inventory.data.actions.length === 0) ? <p>No hay funciones en este workspace.</p> : null}
            {!inventory.loading && !inventory.error && inventory.data?.actions.length ? (
              <div className="space-y-2">
                {inventory.data.actions.map((item) => {
                  const selected = item.resourceId === selectedActionId
                  return (
                    <button
                      className={`w-full rounded-lg border p-3 text-left ${selected ? 'border-primary bg-primary/5' : 'border-border'}`}
                      key={item.resourceId}
                      onClick={() => {
                        setDeployForm((current) => ({ ...current, mode: 'edit' }))
                        setSelectedActionId(item.resourceId)
                      }}
                      type="button"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>{item.actionName}</strong>
                        <Badge variant={statusTone(item.provisioning?.state ?? item.status)}>{formatEnumLabel(item.provisioning?.state ?? item.status)}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">Runtime: {item.execution?.runtime ?? '—'} · Version: {item.activeVersionId ?? '—'}</p>
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-border p-4">
          {!selectedActionId && deployForm.mode !== 'create' ? (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Detalle de la función</h2>
              <p className="text-sm text-muted-foreground">Selecciona una función del inventario para revisar su configuración, activaciones y operaciones disponibles.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{deployForm.mode === 'create' && !selectedActionId ? 'Nueva función' : effectiveAction?.actionName ?? 'Función seleccionada'}</h2>
                {effectiveAction ? <Badge variant={statusTone(effectiveAction.provisioning?.state ?? effectiveAction.status)}>{formatEnumLabel(effectiveAction.provisioning?.state ?? effectiveAction.status)}</Badge> : null}
                {effectiveAction?.provisioning?.state ? <Badge variant="outline">Provisioning: {formatEnumLabel(effectiveAction.provisioning.state)}</Badge> : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {(['detail', 'versions', 'activations', 'triggers', 'invoke', 'deploy'] as FunctionDetailTab[]).map((tab) => (
                  <Button key={tab} onClick={() => setActionDetailTab(tab)} type="button" variant={actionDetailTab === tab ? 'default' : 'outline'}>
                    {tab === 'detail' ? 'Detail' : tab === 'versions' ? 'Versions' : tab === 'activations' ? 'Activations' : tab === 'triggers' ? 'Triggers' : tab === 'invoke' ? 'Invoke' : 'Deploy'}
                  </Button>
                ))}
              </div>

              {actionDetailTab === 'detail' ? (
                <div className="space-y-4">
                  {selectedActionId && actionDetail.loading ? <p>Cargando detalle…</p> : null}
                  {selectedActionId && !actionDetail.loading && actionDetail.error ? <p role="alert">{actionDetail.error}</p> : null}
                  {effectiveAction ? (
                    <>
                      <section className="space-y-3">
                        <h3 className="font-semibold">Identificación</h3>
                        <KeyValueGrid items={[
                          { label: 'Action name', value: effectiveAction.actionName },
                          { label: 'Resource ID', value: effectiveAction.resourceId },
                          { label: 'Package', value: effectiveAction.packageName },
                          { label: 'Namespace', value: effectiveAction.namespaceName },
                          { label: 'Active version', value: effectiveAction.activeVersionId },
                          { label: 'Deployment digest', value: effectiveAction.deploymentDigest }
                        ]} />
                      </section>
                      <section className="space-y-3">
                        <h3 className="font-semibold">Execution</h3>
                        <KeyValueGrid items={[
                          { label: 'Runtime', value: effectiveAction.execution?.runtime },
                          { label: 'Entrypoint', value: effectiveAction.execution?.entrypoint },
                          { label: 'Timeout (ms)', value: effectiveAction.execution?.limits?.timeoutMs },
                          { label: 'Memory (MB)', value: effectiveAction.execution?.limits?.memoryMb },
                          { label: 'Concurrent invocations', value: effectiveAction.execution?.limits?.concurrentInvocations },
                          { label: 'Activation retention', value: effectiveAction.activationPolicy?.retentionDays }
                        ]} />
                      </section>
                      <section className="space-y-3">
                        <h3 className="font-semibold">Configuración avanzada</h3>
                        <KeyValueGrid items={[
                          { label: 'Source kind', value: effectiveAction.source?.kind },
                          { label: 'HTTP enabled', value: effectiveAction.httpExposure?.enabled },
                          { label: 'HTTP URL', value: effectiveAction.httpExposure?.publicUrl },
                          { label: 'HTTP auth', value: effectiveAction.httpExposure?.authPolicy },
                          { label: 'Provisioning state', value: effectiveAction.provisioning?.state },
                          { label: 'Failure class', value: effectiveAction.provisioning?.failureClass }
                        ]} />
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div>
                            <h4 className="mb-2 text-sm font-medium">Environment</h4>
                            <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs">{formatJson(effectiveAction.execution?.environment)}</pre>
                          </div>
                          <div>
                            <h4 className="mb-2 text-sm font-medium">Parameters</h4>
                            <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs">{formatJson(effectiveAction.execution?.parameters)}</pre>
                          </div>
                        </div>
                      </section>
                      <section className="space-y-3">
                        <h3 className="font-semibold">Secretos y timestamps</h3>
                        <KeyValueGrid items={[
                          { label: 'Secret refs', value: effectiveAction.secretReferences?.map((item) => item.secretName).join(', ') || '—' },
                          { label: 'Created at', value: effectiveAction.timestamps?.createdAt },
                          { label: 'Updated at', value: effectiveAction.timestamps?.updatedAt },
                          { label: 'Rollback available', value: effectiveAction.rollbackAvailable }
                        ]} />
                      </section>
                    </>
                  ) : null}
                </div>
              ) : null}

              {actionDetailTab === 'versions' ? (
                <div className="space-y-4">
                  {versions.loading ? <p>Cargando versiones…</p> : null}
                  {!versions.loading && versions.error ? (
                    <div className="space-y-2" role="alert">
                      <p>{versions.error}</p>
                      {selectedActionId ? <Button onClick={() => void loadVersions(selectedActionId)} type="button" variant="outline">Reintentar</Button> : null}
                    </div>
                  ) : null}
                  {!versions.loading && !versions.error && versions.data?.items.length === 0 ? <p>No hay versiones anteriores disponibles.</p> : null}
                  {!versions.loading && !versions.error && versions.data?.items.length ? (
                    <>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-border text-muted-foreground">
                              <th className="py-2 pr-3">Versión</th>
                              <th className="py-2 pr-3">Version ID</th>
                              <th className="py-2 pr-3">Status</th>
                              <th className="py-2 pr-3">Origin</th>
                              <th className="py-2">Created at</th>
                            </tr>
                          </thead>
                          <tbody>
                            {versions.data.items.map((item) => (
                              <tr className="border-b border-border/60" key={item.versionId}>
                                <td className="py-2 pr-3">
                                  <label className="flex items-center gap-2">
                                    <input checked={rollbackTargetVersionId === item.versionId} disabled={!item.rollbackEligible || writeDisabled} name="rollback-version" onChange={() => setRollbackTargetVersionId(item.versionId)} type="radio" />
                                    <span>{formatValue(item.versionNumber)}</span>
                                  </label>
                                </td>
                                <td className="py-2 pr-3">{item.versionId}</td>
                                <td className="py-2 pr-3"><Badge variant={statusTone(item.status)}>{formatEnumLabel(item.status)}</Badge></td>
                                <td className="py-2 pr-3">{formatEnumLabel(item.originType)}</td>
                                <td className="py-2">{formatValue(item.timestamps?.createdAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="space-y-2">
                        <Button disabled={writeDisabled || eligibleRollbackVersions.length === 0 || !rollbackTargetVersionId || rollbackResult.loading} onClick={() => void handleRollback()} type="button">
                          {rollbackResult.loading ? 'Solicitando rollback…' : 'Rollback'}
                        </Button>
                        {eligibleRollbackVersions.length === 0 ? <p className="text-sm text-muted-foreground">No hay versiones anteriores disponibles para rollback.</p> : null}
                        {rollbackResult.error ? <p role="alert">{rollbackResult.error}</p> : null}
                        {rollbackResult.data ? <p role="alert">Rollback {rollbackResult.data.status}: {rollbackResult.data.requestedVersionId}</p> : null}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}

              {actionDetailTab === 'activations' ? (
                <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_1fr]">
                  <div className="space-y-3">
                    {activations.loading ? <p>Cargando activaciones…</p> : null}
                    {!activations.loading && activations.error ? (
                      <div className="space-y-2" role="alert">
                        <p>{activations.error}</p>
                        {selectedActionId ? <Button onClick={() => void loadActivations(selectedActionId)} type="button" variant="outline">Reintentar</Button> : null}
                      </div>
                    ) : null}
                    {!activations.loading && !activations.error && activations.data?.items.length === 0 ? <p>Esta función no tiene activaciones registradas.</p> : null}
                    {activations.data?.items.map((item) => (
                      <button className={`w-full rounded-lg border p-3 text-left ${selectedActivationId === item.activationId ? 'border-primary bg-primary/5' : 'border-border'}`} key={item.activationId} onClick={() => setSelectedActivationId(item.activationId)} type="button">
                        <div className="flex items-center gap-2">
                          <Badge variant={statusTone(item.status)}>{formatEnumLabel(item.status)}</Badge>
                          <span className="text-xs text-muted-foreground">{item.activationId}</span>
                        </div>
                        <p className="mt-2 text-sm">{item.durationMs} ms · {item.triggerKind}</p>
                      </button>
                    ))}
                  </div>
                  <div className="space-y-3 rounded-lg border border-border p-4">
                    {!selectedActivationId ? <p>Selecciona una activación para ver metadata, logs y resultado.</p> : null}
                    {activationDetail.loading ? <p>Cargando detalle de activación…</p> : null}
                    {activationDetail.data.activation ? (
                      <KeyValueGrid items={[
                        { label: 'Status', value: activationDetail.data.activation.status },
                        { label: 'Started at', value: activationDetail.data.activation.startedAt },
                        { label: 'Finished at', value: activationDetail.data.activation.finishedAt },
                        { label: 'Duration (ms)', value: activationDetail.data.activation.durationMs },
                        { label: 'Status code', value: activationDetail.data.activation.statusCode },
                        { label: 'Trigger kind', value: activationDetail.data.activation.triggerKind }
                      ]} />
                    ) : null}
                    {activationDetail.data.activationError ? <p role="alert">{activationDetail.data.activationError}</p> : null}
                    <section className="space-y-2">
                      <h3 className="font-semibold">Logs</h3>
                      {activationDetail.data.logsError ? <p role="alert">{activationDetail.data.logsError}</p> : null}
                      {activationDetail.data.logs?.truncated ? <p className="text-xs text-muted-foreground">Los logs están truncados. Se muestra el contenido disponible.</p> : null}
                      {activationDetail.data.logs && activationDetail.data.logs.lines.length === 0 ? <p>No hay logs disponibles para esta activación.</p> : null}
                      {activationDetail.data.logs ? <pre className="max-h-64 overflow-y-auto rounded bg-muted p-3 text-xs">{activationDetail.data.logs.lines.join('\n')}</pre> : null}
                    </section>
                    <section className="space-y-2">
                      <h3 className="font-semibold">Resultado</h3>
                      {activationDetail.data.resultError ? <p role="alert">{activationDetail.data.resultError}</p> : null}
                      {activationDetail.data.result ? <pre className="max-h-64 overflow-y-auto rounded bg-muted p-3 text-xs">{formatJson(activationDetail.data.result.result ?? activationDetail.data.result)}</pre> : null}
                    </section>
                  </div>
                </div>
              ) : null}

              {actionDetailTab === 'triggers' ? (
                <div className="space-y-4">
                  {!effectiveAction?.kafkaTriggers?.length && !effectiveAction?.cronTriggers?.length && !effectiveAction?.storageTriggers?.length ? <p>No hay trigger bindings configurados para esta función.</p> : null}
                  {effectiveAction?.kafkaTriggers?.length ? (
                    <section className="space-y-2">
                      <h3 className="font-semibold">Kafka</h3>
                      {effectiveAction.kafkaTriggers.map((item) => <p key={item.triggerId ?? item.topicRef}>{item.topicRef ?? item.triggerId} · {formatEnumLabel(item.deliveryMode)} · {formatEnumLabel(item.status)}</p>)}
                    </section>
                  ) : null}
                  {effectiveAction?.cronTriggers?.length ? (
                    <section className="space-y-2">
                      <h3 className="font-semibold">Cron</h3>
                      {effectiveAction.cronTriggers.map((item) => <p key={item.triggerId ?? item.schedule}>{item.schedule ?? item.triggerId} · {formatValue(item.timezone)} · {formatEnumLabel(item.status)}</p>)}
                    </section>
                  ) : null}
                  {effectiveAction?.storageTriggers?.length ? (
                    <section className="space-y-2">
                      <h3 className="font-semibold">Storage</h3>
                      {effectiveAction.storageTriggers.map((item) => <p key={item.triggerId ?? item.bucketRef}>{item.bucketRef ?? item.triggerId} · {item.eventTypes?.join(', ') || '—'} · {formatEnumLabel(item.status)}</p>)}
                    </section>
                  ) : null}
                </div>
              ) : null}

              {actionDetailTab === 'invoke' ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium" htmlFor="functions-invoke-payload">Payload JSON</label>
                    <textarea className="min-h-36 w-full rounded-md border border-input bg-background p-3 text-sm" id="functions-invoke-payload" onChange={(event) => setInvokeForm((current) => ({ ...current, parametersJson: event.target.value }))} value={invokeForm.parametersJson} />
                  </div>
                  <label className="block text-sm font-medium">Response mode
                    <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" onChange={(event) => setInvokeForm((current) => ({ ...current, responseMode: event.target.value as 'accepted' | 'wait_for_result' }))} value={invokeForm.responseMode}>
                      <option value="accepted">accepted</option>
                      <option value="wait_for_result">wait_for_result</option>
                    </select>
                  </label>
                  <Button disabled={!selectedActionId || writeDisabled || invokeResult.loading} onClick={() => void handleInvoke()} type="button">{invokeResult.loading ? 'Invocando…' : 'Invocar'}</Button>
                  {writeDisabled ? <p className="text-sm text-muted-foreground">La función no admite acciones de escritura mientras su provisioning no sea accionable.</p> : null}
                  {invokeResult.error ? (
                    <div className="rounded-lg border border-destructive/40 p-3 text-sm" role="alert">
                      <p>{invokeResult.error}</p>
                      {invokeResult.error.includes('quota') || invokeResult.error.includes('429') ? <p className="mt-2 text-muted-foreground">Revisa límites o enforcement antes de reintentar.</p> : null}
                    </div>
                  ) : null}
                  {invokeResult.data ? (
                    <div className="rounded-lg border border-border p-3 text-sm" role="alert">
                      <p><strong>Invocation ID:</strong> {invokeResult.data.invocationId}</p>
                      <p><strong>Status:</strong> {invokeResult.data.status}</p>
                      <p><strong>Accepted at:</strong> {invokeResult.data.acceptedAt}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {actionDetailTab === 'deploy' ? (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block text-sm font-medium">Action name
                      <input className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" disabled={deployForm.mode === 'edit'} onChange={(event) => setDeployForm((current) => ({ ...current, actionName: event.target.value }))} type="text" value={deployForm.actionName} />
                    </label>
                    <label className="block text-sm font-medium">Runtime
                      <input className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" onChange={(event) => setDeployForm((current) => ({ ...current, runtime: event.target.value }))} type="text" value={deployForm.runtime} />
                    </label>
                    <label className="block text-sm font-medium">Entrypoint
                      <input className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" onChange={(event) => setDeployForm((current) => ({ ...current, entrypoint: event.target.value }))} type="text" value={deployForm.entrypoint} />
                    </label>
                    <label className="block text-sm font-medium">Timeout (ms)
                      <input className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" onChange={(event) => setDeployForm((current) => ({ ...current, timeoutMs: event.target.value }))} type="number" value={deployForm.timeoutMs} />
                    </label>
                    <label className="block text-sm font-medium">Memory (MB)
                      <input className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" onChange={(event) => setDeployForm((current) => ({ ...current, memoryMb: event.target.value }))} type="number" value={deployForm.memoryMb} />
                    </label>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium" htmlFor="functions-inline-code">Inline code</label>
                    <textarea className="min-h-48 w-full rounded-md border border-input bg-background p-3 text-sm" id="functions-inline-code" onChange={(event) => setDeployForm((current) => ({ ...current, inlineCode: event.target.value }))} value={deployForm.inlineCode} />
                  </div>
                  <Button disabled={writeDisabled || deployResult.loading} onClick={() => void handleDeploy()} type="button">{deployResult.loading ? 'Desplegando…' : deployForm.mode === 'create' ? 'Crear función' : 'Actualizar función'}</Button>
                  {writeDisabled && deployForm.mode === 'edit' ? <p className="text-sm text-muted-foreground">No se permiten cambios mientras la función esté en provisioning, degraded o suspended.</p> : null}
                  {deployResult.error ? <p role="alert">{deployResult.error}</p> : null}
                  {deployResult.data ? <p role="alert">Solicitud aceptada{deployResult.data.resourceId ? ` para ${deployResult.data.resourceId}` : ''}.</p> : null}
                </div>
              ) : null}
            </div>
          )}
        </section>
      </section>
    </main>
  )
}
