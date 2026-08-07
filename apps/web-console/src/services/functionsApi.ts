// Functions data client for the console (change: add-console-functions-data-editor).
// Calls the published control-plane function routes exactly: list by workspace,
// deploy at the actions collection, and operate by action resourceId.
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { JsonValue } from '@/lib/http'

const enc = encodeURIComponent

type JsonObject = Record<string, JsonValue>

export interface FunctionDeploymentSource {
  kind: string
  language?: string
  inlineCode?: string
  artifactRef?: string
  storedObjectRef?: string
  imageRef?: string
  digest?: string
  entryFile?: string
  imageEntrypoint?: string
}

export interface FunctionExecutionConfiguration {
  runtime?: string
  entrypoint?: string
  parameters?: JsonObject
  environment?: Record<string, string>
  limits?: JsonObject
  webAction?: JsonObject
}

export interface FunctionActivationPolicy {
  logsAccess?: 'workspace_developers' | 'workspace_admins' | 'service_accounts' | 'disabled'
  resultAccess?: 'workspace_developers' | 'workspace_admins' | 'service_accounts' | 'disabled'
  rerunPolicy?: 'manual_only' | 'blocked' | 'idempotent_only'
  retentionHours?: number
  redactionMode?: 'metadata_only' | 'logs_only' | 'logs_and_results'
  mode?: string
  retentionDays?: number
}

export interface FunctionRecord {
  resourceId: string
  actionName: string
  tenantId?: string
  workspaceId?: string
  source?: FunctionDeploymentSource
  execution?: FunctionExecutionConfiguration
  activationPolicy?: FunctionActivationPolicy
  status?: string
  updatedAt?: string
  timestamps?: {
    createdAt?: string
    updatedAt?: string
  }
}

export interface GatewayMutationAccepted {
  acceptedAt: string
  correlationId: string
  family: string
  requestId: string
  resourceId: string
  resourceType: string
  status: string
}

// Function delete has its own accepted envelope (change: add-managed-knative-serving, #933):
// a delete while the Knative runtime is unavailable is atomically recorded as `deletion_pending`
// rather than reporting the Knative Service gone, so the response is the deletion-specific shape
// (not the generic GatewayMutationAccepted returned by deploy/update).
export interface FunctionDeletionAccepted {
  acceptedAt: string
  correlationId: string
  requestId: string
  resourceId: string
  status: 'accepted' | 'deletion_pending'
}

export interface InvocationResult {
  result?: JsonValue
  activationId?: string
  durationMs?: number
  logs?: string[]
}

export interface ActivationRecord {
  activationId: string
  status?: string
  startedAt?: string
  durationMs?: number
}

export type LegacyFunctionDeploySpec = {
  tenantId?: string
  name?: string
  actionName?: string
  runtime?: string
  code?: string
  main?: string
  entrypoint?: string
  limits?: JsonObject
  parameters?: JsonObject
  environment?: Record<string, string>
} & Record<string, JsonValue | undefined>

export type FunctionActionWriteRequest = {
  tenantId?: string
  workspaceId: string
  actionName: string
  packageName?: string
  source: FunctionDeploymentSource
  execution: FunctionExecutionConfiguration
  activationPolicy: FunctionActivationPolicy
} & Record<string, JsonValue | undefined>

export type FunctionInvocationWriteRequest = {
  parameters?: JsonValue
  triggerContext?: JsonObject
  responseMode?: 'accepted' | 'wait_for_result'
  idempotencyScope?: 'request' | 'payload_digest'
} & Record<string, JsonValue | undefined>

const workspaceActionsBase = (workspaceId: string) => `/v1/functions/workspaces/${enc(workspaceId)}/actions`
const actionResourceBase = (resourceId: string) => `/v1/functions/actions/${enc(resourceId)}`

export function listFunctions(workspaceId: string): Promise<{ items: FunctionRecord[] }> {
  return requestConsoleSessionJson<{ items: FunctionRecord[] }>(workspaceActionsBase(workspaceId))
}

export function deployFunction(
  workspaceId: string,
  spec: LegacyFunctionDeploySpec | FunctionActionWriteRequest,
  tenantId?: string
): Promise<GatewayMutationAccepted> {
  return requestConsoleSessionJson<GatewayMutationAccepted>('/v1/functions/actions', {
    method: 'POST',
    body: toFunctionActionWriteRequest(workspaceId, spec, tenantId) as unknown as JsonValue
  })
}

export function getFunction(resourceId: string): Promise<FunctionRecord> {
  return requestConsoleSessionJson<FunctionRecord>(actionResourceBase(resourceId))
}

export function deleteFunction(resourceId: string, idempotencyKey?: string): Promise<FunctionDeletionAccepted> {
  return requestConsoleSessionJson<FunctionDeletionAccepted>(actionResourceBase(resourceId), {
    method: 'DELETE',
    ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {})
  })
}

export function invokeFunction(
  resourceId: string,
  payload: JsonValue
): Promise<InvocationResult> {
  return requestConsoleSessionJson<InvocationResult>(
    `${actionResourceBase(resourceId)}/invocations`,
    { method: 'POST', body: toFunctionInvocationWriteRequest(payload) as unknown as JsonValue }
  )
}

export function listActivations(resourceId: string): Promise<{ items: ActivationRecord[] }> {
  return requestConsoleSessionJson<{ items: ActivationRecord[] }>(
    `${actionResourceBase(resourceId)}/activations`
  )
}

function toFunctionActionWriteRequest(
  workspaceId: string,
  spec: LegacyFunctionDeploySpec | FunctionActionWriteRequest,
  tenantId?: string
): FunctionActionWriteRequest {
  const effectiveTenantId = requiredString(tenantId ?? stringValue(spec.tenantId), 'tenantId')

  if (isJsonObject(spec.source) && isJsonObject(spec.execution)) {
    const { name: _name, runtime: _runtime, code: _code, main: _main, entrypoint: _entrypoint, ...rest } = spec
    const actionName = stringValue(spec.actionName) ?? stringValue(spec.name)
    return {
      ...rest,
      tenantId: effectiveTenantId,
      workspaceId,
      ...(actionName ? { actionName } : {})
    } as FunctionActionWriteRequest
  }

  const actionName = stringValue(spec.actionName) ?? stringValue(spec.name) ?? ''
  const inlineCode = stringValue(spec.code) ?? ''
  const runtime = normalizeRuntime(stringValue(spec.runtime))
  const entrypoint = stringValue(spec.entrypoint) ?? stringValue(spec.main) ?? 'main'

  return {
    tenantId: effectiveTenantId,
    workspaceId,
    actionName,
    source: {
      kind: 'inline_code',
      language: 'javascript',
      inlineCode,
      entryFile: 'index.js'
    },
    execution: {
      runtime,
      entrypoint,
      parameters: isJsonObject(spec.parameters) ? spec.parameters : {},
      environment: isStringRecord(spec.environment) ? spec.environment : {},
      limits: normalizeLimits(isJsonObject(spec.limits) ? spec.limits : undefined),
      webAction: {
        enabled: false,
        requireAuthentication: true,
        rawHttpResponse: false
      }
    },
    activationPolicy: {
      logsAccess: 'workspace_developers',
      resultAccess: 'workspace_developers',
      rerunPolicy: 'manual_only',
      retentionHours: 168
    }
  }
}

function toFunctionInvocationWriteRequest(payload: JsonValue): FunctionInvocationWriteRequest {
  if (isJsonObject(payload) && isInvocationEnvelope(payload)) {
    return payload as FunctionInvocationWriteRequest
  }
  return { parameters: payload }
}

function isInvocationEnvelope(value: JsonObject): boolean {
  return (
    Object.prototype.hasOwnProperty.call(value, 'parameters') ||
    Object.prototype.hasOwnProperty.call(value, 'triggerContext') ||
    Object.prototype.hasOwnProperty.call(value, 'responseMode') ||
    Object.prototype.hasOwnProperty.call(value, 'idempotencyScope')
  )
}

function normalizeRuntime(runtime: string | undefined): string {
  if (runtime == null || runtime === '' || runtime === 'nodejs') return 'nodejs:20'
  return runtime
}

function normalizeLimits(limits: JsonObject | undefined): JsonObject {
  const timeoutSeconds = numericValue(limits?.timeoutSeconds) ?? timeoutMsToSeconds(numericValue(limits?.timeoutMs)) ?? 60
  const memoryMb = numericValue(limits?.memoryMb) ?? 256
  return { timeoutSeconds, memoryMb }
}

function timeoutMsToSeconds(timeoutMs: number | undefined): number | undefined {
  return timeoutMs == null ? undefined : Math.max(1, Math.ceil(timeoutMs / 1000))
}

function numericValue(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function requiredString(value: string | undefined, fieldName: string): string {
  if (value == null || value.trim() === '') {
    throw new Error(`${fieldName} is required`)
  }
  return value.trim()
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isJsonObject(value) && Object.values(value).every((entry) => typeof entry === 'string')
}

// ---- Function definition export / import (change: add-data-export-import-clone, #683) ----
export interface FunctionDefinitionBundle {
  bundleVersion: string
  tenantId: string
  workspaceId: string
  scope?: { tenantId: string; workspaceId: string }
  resources: Array<Record<string, JsonValue>>
  definitions?: Array<Record<string, JsonValue>>
}

export interface FunctionDefinitionImportResult {
  entityType: string
  targetTenantId: string
  targetWorkspaceId: string
  totalEntries: number
  importedCount: number
  skippedCount: number
}

// Export ONE action's deployable definition bundle (source/runtime/entrypoint/parameters).
export function exportFunctionDefinition(resourceId: string): Promise<FunctionDefinitionBundle> {
  return requestConsoleSessionJson<FunctionDefinitionBundle>(
    `/v1/functions/actions/${enc(resourceId)}/definition-export`
  )
}

// Export every action in a package within a workspace.
export function exportPackageDefinition(workspaceId: string, packageName: string): Promise<FunctionDefinitionBundle> {
  return requestConsoleSessionJson<FunctionDefinitionBundle>(
    `/v1/functions/workspaces/${enc(workspaceId)}/packages/${enc(packageName)}/definition-export`
  )
}

// Import a definition bundle into the caller's workspace (re-scoped to the verified tenant/workspace;
// a cross-scope bundle is rejected server-side with IMPORT_SCOPE_VIOLATION).
export function importFunctionDefinition(
  workspaceId: string,
  bundle: FunctionDefinitionBundle
): Promise<FunctionDefinitionImportResult> {
  return requestConsoleSessionJson<FunctionDefinitionImportResult>(
    `/v1/functions/workspaces/${enc(workspaceId)}/definition-imports`,
    { method: 'POST', body: bundle as unknown as JsonValue }
  )
}

// Import a package definition bundle (every definition must carry a package).
export function importPackageDefinition(
  workspaceId: string,
  bundle: FunctionDefinitionBundle
): Promise<FunctionDefinitionImportResult> {
  return requestConsoleSessionJson<FunctionDefinitionImportResult>(
    `/v1/functions/workspaces/${enc(workspaceId)}/package-definition-imports`,
    { method: 'POST', body: bundle as unknown as JsonValue }
  )
}
