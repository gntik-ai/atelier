/**
 * issue-933-managed-knative-runtime | add-managed-knative-serving
 *
 * Personas: P18 installer, P3 platform operator, P8 Function developer, P7 MCP owner,
 * P12 MCP consumer, P10 read-only auditor, and P13 adjacent-tenant adversary.
 * Capabilities: fn-managed-knative-runtime-status, fn-managed-knative-functions,
 * fn-managed-knative-hosted-mcp, fn-managed-knative-outage-recovery,
 * fn-managed-knative-tenant-isolation, fn-managed-knative-observability,
 * fn-managed-knative-owner-scoped-teardown, and fn-managed-knative-console-readiness.
 *
 * This is a REAL-stack acceptance spec. It uses only the Falcone console/public APIs, the public
 * OpenShift/Kubernetes APIs that P18 operates, and the companion chart's installed lifecycle CLI.
 * It does not import product internals, mock a product route, insert database state, or silently
 * substitute kind for the required OpenShift acceptance environment.
 *
 * Fail-closed acceptance gate
 * ---------------------------
 * Full acceptance is skipped with an explicit annotation unless ALL REMOTE_ACCEPTANCE_ENV values
 * below are present and E2E_933_ACCEPTANCE_PROFILE is exactly
 * `remote-openshift-4.21-cluster-admin`. A non-default run ID and a short-lived disposable-target
 * attestation must name the expected Infrastructure object/id and kube-system namespace UID. The
 * spec rejects non-HTTPS and local/loopback/CRC API hosts, then reconciles every attested field with
 * the live OpenShift APIs. It also proves OpenShift 4.21/Kubernetes 1.34, reconciles the current
 * SelfSubjectReview identity with a live cluster-admin ClusterRoleBinding, and retains selected
 * cluster-scoped permission probes. Environment claims alone are therefore insufficient to pass.
 *
 * Chart issue #8 must publish a Helm-owned lifecycle status ConfigMap. Its schema, coordinated
 * release/version/status, run ID, cluster identity, and lifecycle executable SHA-256 must match
 * both the environment, the local executable, and those live OpenShift identities before any
 * workload or lifecycle scenario can run.
 * The disposable attestation is deliberately redundant with live discovery and expires quickly:
 *   E2E_933_DISPOSABLE_ATTESTATION_JSON='{"runId":"ocp421-...","apiUrl":"https://api...:6443","infrastructureName":"cluster","infrastructureId":"...","clusterUid":"...","expiresAt":"<ISO-8601, 5m..72h ahead>"}'
 *
 * Lifecycle command variables are JSON argv arrays. They are rejected unless argv[0] equals
 * E2E_933_CHART_LIFECYCLE_EXECUTABLE (whose basename must be `falcone-knative`), argv[1] is
 * `acceptance`, argv[2] is the exact operation (`outage`, `restart`, `recover`, or the chart-owned
 * `replacement-conflict` acceptance hook), and the only
 * remaining arguments are explicit --api-server/--cluster-uid/--infrastructure-name/
 * --infrastructure-id/--run-id/--release/--status-namespace/--status-configmap pairs that match
 * the already verified live target. They are executed without a shell. The companion chart owns
 * their implementation; this repository only consumes its public CLI.
 * Example shape (the concrete values must match the live-attested target exactly):
 *   ["/path/falcone-knative","acceptance","outage","--api-server","https://api...:6443","--cluster-uid","...","--infrastructure-name","cluster","--infrastructure-id","...","--run-id","ocp421-...","--release","falcone-knative","--status-namespace","knative-serving","--status-configmap","falcone-knative-status"]
 *
 * A local kind run may opt into the separately labelled contract/regression subset with
 * E2E_933_LOCAL_REGRESSION=1. That subset never satisfies or claims OpenShift acceptance.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test'

const execFileAsync = promisify(execFile)
const API_VERSION = '2026-03-26'
const ACCEPTANCE_PROFILE = 'remote-openshift-4.21-cluster-admin'
const MANAGED_API = process.env.E2E_933_API_BASE_URL ?? process.env.E2E_API_BASE_URL ?? process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const MANAGED_CONSOLE = process.env.E2E_933_CONSOLE_BASE_URL ?? process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const EXTERNAL_API = process.env.E2E_933_EXTERNAL_API_BASE_URL ?? ''
const DISABLED_API = process.env.E2E_933_DISABLED_API_BASE_URL ?? ''
const OPENSHIFT_API = (process.env.E2E_933_OPENSHIFT_API_URL ?? '').replace(/\/+$/, '')
const METRICS_URL = process.env.E2E_933_METRICS_URL ?? ''
const RUN_ID_INPUT = (process.env.E2E_933_RUN_ID ?? '').trim()
const RUN_ID = RUN_ID_INPUT.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'missing-run-id'
const SAME_NAME = `e2e-${RUN_ID}`.slice(0, 63).replace(/-+$/, '')

const ENV = {
  operatorToken: process.env.E2E_933_PLATFORM_OPERATOR_TOKEN ?? '',
  auditorToken: process.env.E2E_933_PLATFORM_AUDITOR_TOKEN ?? '',
  adminToken: process.env.E2E_933_PLATFORM_ADMIN_TOKEN ?? '',
  superadminToken: process.env.E2E_933_SUPERADMIN_TOKEN ?? '',
  functionDeveloperToken: process.env.E2E_933_FUNCTION_DEVELOPER_TOKEN ?? '',
  mcpOwnerToken: process.env.E2E_933_MCP_OWNER_TOKEN ?? '',
  mcpConsumerToken: process.env.E2E_933_MCP_CONSUMER_TOKEN ?? '',
  tenantBToken: process.env.E2E_933_TENANT_B_TOKEN ?? '',
  externalOperatorToken: process.env.E2E_933_EXTERNAL_OPERATOR_TOKEN ?? '',
  disabledOperatorToken: process.env.E2E_933_DISABLED_OPERATOR_TOKEN ?? '',
  disabledTenantToken: process.env.E2E_933_DISABLED_TENANT_TOKEN ?? '',
  tenantRealmOperatorToken: process.env.E2E_933_TENANT_REALM_OPERATOR_TOKEN ?? '',
  tenantRealmAuditorToken: process.env.E2E_933_TENANT_REALM_AUDITOR_TOKEN ?? '',
  sameTenantWrongWorkspaceToken: process.env.E2E_933_SAME_TENANT_WRONG_WORKSPACE_TOKEN ?? '',
  tenantOwnerOnlyToken: process.env.E2E_933_TENANT_OWNER_ONLY_TOKEN ?? '',
  tenantAdminOnlyToken: process.env.E2E_933_TENANT_ADMIN_ONLY_TOKEN ?? '',
  internalActorToken: process.env.E2E_933_INTERNAL_ACTOR_TOKEN ?? '',
  actorSuperadminToken: process.env.E2E_933_ACTOR_SUPERADMIN_TOKEN ?? '',
  teardownOwnerToken: process.env.E2E_933_TEARDOWN_OWNER_TOKEN ?? '',
  openshiftToken: process.env.E2E_933_OPENSHIFT_TOKEN ?? '',
  tenantA: process.env.E2E_933_TENANT_A ?? '',
  workspaceA: process.env.E2E_933_WORKSPACE_A ?? '',
  tenantB: process.env.E2E_933_TENANT_B ?? '',
  workspaceB: process.env.E2E_933_WORKSPACE_B ?? '',
  operatorUser: process.env.E2E_933_OPERATOR_USER ?? '',
  operatorPassword: process.env.E2E_933_OPERATOR_PASSWORD ?? '',
  auditorUser: process.env.E2E_933_AUDITOR_USER ?? '',
  auditorPassword: process.env.E2E_933_AUDITOR_PASSWORD ?? '',
  mcpOwnerUser: process.env.E2E_933_MCP_OWNER_USER ?? '',
  mcpOwnerPassword: process.env.E2E_933_MCP_OWNER_PASSWORD ?? '',
  appNamespace: process.env.E2E_933_APP_NAMESPACE ?? '',
  mcpNamespaceA: process.env.E2E_933_MCP_NAMESPACE_A ?? '',
  mcpNamespaceB: process.env.E2E_933_MCP_NAMESPACE_B ?? '',
  teardownTenant: process.env.E2E_933_TEARDOWN_TENANT ?? '',
  teardownReadyWorkspace: process.env.E2E_933_TEARDOWN_READY_WORKSPACE ?? '',
  teardownOutageWorkspace: process.env.E2E_933_TEARDOWN_OUTAGE_WORKSPACE ?? '',
  teardownNamespace: process.env.E2E_933_TEARDOWN_NAMESPACE ?? '',
  executorMetricsUrl: process.env.E2E_933_EXECUTOR_METRICS_URL ?? '',
  expectedInfrastructureName: process.env.E2E_933_EXPECTED_INFRASTRUCTURE_NAME ?? '',
  expectedInfrastructureId: process.env.E2E_933_EXPECTED_INFRASTRUCTURE_ID ?? '',
  expectedClusterUid: process.env.E2E_933_EXPECTED_CLUSTER_UID ?? '',
  expectedClusterAdminUser: process.env.E2E_933_EXPECTED_CLUSTER_ADMIN_USER ?? '',
  chartRelease: process.env.E2E_933_CHART_ISSUE8_RELEASE ?? '',
  chartVersion: process.env.E2E_933_CHART_ISSUE8_VERSION ?? '',
  chartStatusNamespace: process.env.E2E_933_CHART_STATUS_NAMESPACE ?? '',
  chartStatusConfigMap: process.env.E2E_933_CHART_STATUS_CONFIGMAP ?? '',
  chartStatusDataKey: process.env.E2E_933_CHART_STATUS_DATA_KEY ?? '',
  chartLifecycleExecutable: process.env.E2E_933_CHART_LIFECYCLE_EXECUTABLE ?? '',
  chartLifecycleSha256: process.env.E2E_933_CHART_LIFECYCLE_SHA256 ?? '',
}

const REMOTE_ACCEPTANCE_ENV = [
  'E2E_933_API_BASE_URL',
  'E2E_933_CONSOLE_BASE_URL',
  'E2E_933_EXTERNAL_API_BASE_URL',
  'E2E_933_DISABLED_API_BASE_URL',
  'E2E_933_OPENSHIFT_API_URL',
  'E2E_933_OPENSHIFT_TOKEN',
  'E2E_933_RUN_ID',
  'E2E_933_EXPECTED_INFRASTRUCTURE_NAME',
  'E2E_933_EXPECTED_INFRASTRUCTURE_ID',
  'E2E_933_EXPECTED_CLUSTER_UID',
  'E2E_933_EXPECTED_CLUSTER_ADMIN_USER',
  'E2E_933_DISPOSABLE_ATTESTATION_JSON',
  'E2E_933_CHART_ISSUE8_RELEASE',
  'E2E_933_CHART_ISSUE8_VERSION',
  'E2E_933_CHART_ISSUE8_STATUS',
  'E2E_933_CHART_STATUS_NAMESPACE',
  'E2E_933_CHART_STATUS_CONFIGMAP',
  'E2E_933_CHART_STATUS_DATA_KEY',
  'E2E_933_CHART_LIFECYCLE_EXECUTABLE',
  'E2E_933_CHART_LIFECYCLE_SHA256',
  'E2E_933_PLATFORM_OPERATOR_TOKEN',
  'E2E_933_PLATFORM_AUDITOR_TOKEN',
  'E2E_933_PLATFORM_ADMIN_TOKEN',
  'E2E_933_SUPERADMIN_TOKEN',
  'E2E_933_FUNCTION_DEVELOPER_TOKEN',
  'E2E_933_MCP_OWNER_TOKEN',
  'E2E_933_MCP_CONSUMER_TOKEN',
  'E2E_933_TENANT_B_TOKEN',
  'E2E_933_EXTERNAL_OPERATOR_TOKEN',
  'E2E_933_DISABLED_OPERATOR_TOKEN',
  'E2E_933_DISABLED_TENANT_TOKEN',
  'E2E_933_TENANT_REALM_OPERATOR_TOKEN',
  'E2E_933_TENANT_REALM_AUDITOR_TOKEN',
  'E2E_933_SAME_TENANT_WRONG_WORKSPACE_TOKEN',
  'E2E_933_TENANT_OWNER_ONLY_TOKEN',
  'E2E_933_TENANT_ADMIN_ONLY_TOKEN',
  'E2E_933_INTERNAL_ACTOR_TOKEN',
  'E2E_933_ACTOR_SUPERADMIN_TOKEN',
  'E2E_933_TEARDOWN_OWNER_TOKEN',
  'E2E_933_TENANT_A',
  'E2E_933_WORKSPACE_A',
  'E2E_933_TENANT_B',
  'E2E_933_WORKSPACE_B',
  'E2E_933_OPERATOR_USER',
  'E2E_933_OPERATOR_PASSWORD',
  'E2E_933_AUDITOR_USER',
  'E2E_933_AUDITOR_PASSWORD',
  'E2E_933_MCP_OWNER_USER',
  'E2E_933_MCP_OWNER_PASSWORD',
  'E2E_933_APP_NAMESPACE',
  'E2E_933_MCP_NAMESPACE_A',
  'E2E_933_MCP_NAMESPACE_B',
  'E2E_933_TEARDOWN_TENANT',
  'E2E_933_TEARDOWN_READY_WORKSPACE',
  'E2E_933_TEARDOWN_OUTAGE_WORKSPACE',
  'E2E_933_TEARDOWN_NAMESPACE',
  'E2E_933_METRICS_URL',
  'E2E_933_EXECUTOR_METRICS_URL',
  'E2E_933_OUTAGE_COMMAND_JSON',
  'E2E_933_RESTART_COMMAND_JSON',
  'E2E_933_RECOVERY_COMMAND_JSON',
  'E2E_933_MCP_REPLACEMENT_COMMAND_JSON',
] as const

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type JsonObject = { [key: string]: Json }
type FunctionActorFixture = {
  persona: 'P8' | 'P13'
  token: string
  tenantId: string
  workspaceId: string
}
type RuntimeMode = 'managed' | 'external' | 'disabled'
type RuntimeStatus = {
  mode: RuntimeMode
  owner: string
  version: string | null
  compatibility: 'compatible' | 'incompatible' | 'unverified'
  state: 'ready' | 'unverified' | 'degraded' | 'unavailable' | 'disabled'
  stage: string
  reason: string
  lastTransitionAt: string | null
}

type CommandSpec = { file: string; args: string[] }
type LifecycleCommandName = 'E2E_933_OUTAGE_COMMAND_JSON' | 'E2E_933_RESTART_COMMAND_JSON' | 'E2E_933_RECOVERY_COMMAND_JSON'
type VerifiedTarget = {
  apiUrl: string
  runId: string
  infrastructureName: string
  infrastructureId: string
  clusterUid: string
  release: string
  chartVersion: string
  statusNamespace: string
  statusConfigMap: string
  lifecycleSha256: string
}
type DisposableAttestation = {
  runId: string
  apiUrl: string
  infrastructureName: string
  infrastructureId: string
  clusterUid: string
  expiresAt: string
}

const P8_FUNCTION_ACTOR: FunctionActorFixture = {
  persona: 'P8',
  token: ENV.functionDeveloperToken,
  tenantId: ENV.tenantA,
  workspaceId: ENV.workspaceA,
}

const P13_FUNCTION_ACTOR: FunctionActorFixture = {
  persona: 'P13',
  token: ENV.tenantBToken,
  tenantId: ENV.tenantB,
  workspaceId: ENV.workspaceB,
}

const GATEWAY_MUTATION_ACCEPTED_KEYS = [
  'acceptedAt',
  'correlationId',
  'family',
  'requestId',
  'resourceId',
  'resourceType',
  'status',
] as const

const LIFECYCLE_OPERATION: Record<LifecycleCommandName, 'outage' | 'restart' | 'recover'> = {
  E2E_933_OUTAGE_COMMAND_JSON: 'outage',
  E2E_933_RESTART_COMMAND_JSON: 'restart',
  E2E_933_RECOVERY_COMMAND_JSON: 'recover',
}

function targetFromEnvironment(): VerifiedTarget {
  return {
    apiUrl: OPENSHIFT_API,
    runId: RUN_ID,
    infrastructureName: ENV.expectedInfrastructureName,
    infrastructureId: ENV.expectedInfrastructureId,
    clusterUid: ENV.expectedClusterUid,
    release: ENV.chartRelease,
    chartVersion: ENV.chartVersion,
    statusNamespace: ENV.chartStatusNamespace,
    statusConfigMap: ENV.chartStatusConfigMap,
    lifecycleSha256: ENV.chartLifecycleSha256,
  }
}

function remoteApiError(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'E2E_933_OPENSHIFT_API_URL(valid URL)'
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  const forbiddenExact = new Set([
    'localhost',
    'host.docker.internal',
    'kubernetes.default.svc',
    'kubernetes.default.svc.cluster.local',
    '::1',
  ])
  if (url.protocol !== 'https:') return 'E2E_933_OPENSHIFT_API_URL(remote HTTPS required)'
  if (url.username || url.password) return 'E2E_933_OPENSHIFT_API_URL(credentials forbidden in URL)'
  if (
    forbiddenExact.has(hostname)
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.crc.testing')
    || /^127(?:\.\d{1,3}){3}$/.test(hostname)
  ) return 'E2E_933_OPENSHIFT_API_URL(local/loopback/CRC target rejected)'
  return null
}

function parseDisposableAttestation(): DisposableAttestation | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(process.env.E2E_933_DISPOSABLE_ATTESTATION_JSON ?? '')
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const value = parsed as Record<string, unknown>
  if (!['runId', 'apiUrl', 'infrastructureName', 'infrastructureId', 'clusterUid', 'expiresAt']
    .every((key) => typeof value[key] === 'string' && String(value[key]).trim().length > 0)) return null
  return value as unknown as DisposableAttestation
}

function disposableAttestationError(): string | null {
  const attestation = parseDisposableAttestation()
  if (!attestation) return 'E2E_933_DISPOSABLE_ATTESTATION_JSON(valid object)'
  if (
    attestation.runId !== RUN_ID
    || attestation.apiUrl.replace(/\/+$/, '') !== OPENSHIFT_API
    || attestation.infrastructureName !== ENV.expectedInfrastructureName
    || attestation.infrastructureId !== ENV.expectedInfrastructureId
    || attestation.clusterUid !== ENV.expectedClusterUid
  ) return 'E2E_933_DISPOSABLE_ATTESTATION_JSON(target identity mismatch)'
  const expiry = Date.parse(attestation.expiresAt)
  const remainingMs = expiry - Date.now()
  if (!Number.isFinite(expiry) || remainingMs < 5 * 60_000 || remainingMs > 72 * 60 * 60_000) {
    return 'E2E_933_DISPOSABLE_ATTESTATION_JSON(expiresAt must be 5m..72h in the future)'
  }
  return null
}

function missingAcceptancePrerequisites(): string[] {
  const missing: string[] = REMOTE_ACCEPTANCE_ENV.filter((name) => !(process.env[name] ?? '').trim())
  if (process.env.E2E_933_ACCEPTANCE_PROFILE !== ACCEPTANCE_PROFILE) {
    missing.unshift(`E2E_933_ACCEPTANCE_PROFILE=${ACCEPTANCE_PROFILE}`)
  }
  if (
    !/^[a-z0-9][a-z0-9-]{7,31}$/.test(RUN_ID_INPUT)
    || RUN_ID_INPUT !== RUN_ID
    || ['issue933', 'issue-933', 'default', 'test', 'acceptance'].includes(RUN_ID)
  ) missing.push('E2E_933_RUN_ID(non-default 8..32 lowercase alnum/hyphen value)')
  const apiError = remoteApiError(OPENSHIFT_API)
  if (apiError) missing.push(apiError)
  const attestationError = disposableAttestationError()
  if (attestationError) missing.push(attestationError)
  if (process.env.E2E_933_CHART_ISSUE8_STATUS !== 'compatible') {
    missing.push('E2E_933_CHART_ISSUE8_STATUS=compatible')
  }
  if (!ENV.chartLifecycleExecutable || basename(ENV.chartLifecycleExecutable) !== 'falcone-knative') {
    missing.push('E2E_933_CHART_LIFECYCLE_EXECUTABLE(path basename must be falcone-knative)')
  }
  if (!/^[a-f0-9]{64}$/.test(ENV.chartLifecycleSha256)) {
    missing.push('E2E_933_CHART_LIFECYCLE_SHA256(lowercase SHA-256)')
  }
  const environmentTarget = targetFromEnvironment()
  for (const name of Object.keys(LIFECYCLE_OPERATION) as LifecycleCommandName[]) {
    try {
      parseCommand(name, environmentTarget)
    } catch {
      missing.push(`${name}(strict chart-owned argv/verified-target contract)`)
    }
  }
  try {
    parseReplacementCommand(environmentTarget)
  } catch {
    missing.push('E2E_933_MCP_REPLACEMENT_COMMAND_JSON(strict chart-owned argv/verified-target contract)')
  }
  return [...new Set(missing)]
}

const missingAcceptance = missingAcceptancePrerequisites()
const acceptanceSkipReason = [
  'OpenShift acceptance is fail-closed: companion gntik-ai/falcone-charts#8 must publish a compatible coordinated release,',
  'and a live-attested disposable REMOTE OpenShift 4.21 cluster-admin target must be supplied. kind/CRC/local OpenShift are rejected, not substitutes.',
  `Missing or incompatible prerequisites: ${missingAcceptance.join(', ') || 'none'}`,
].join(' ')

function correlation(label: string): string {
  return `corr-933-${RUN_ID}-${label}`.slice(0, 128)
}

function idempotency(label: string): string {
  return `idem-933-${RUN_ID}-${label}`.slice(0, 128)
}

function authHeaders(token: string, label: string, mutating = false): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
    'content-type': 'application/json',
    'x-api-version': API_VERSION,
    'x-correlation-id': correlation(label),
    ...(mutating ? { 'idempotency-key': idempotency(label) } : {}),
  }
}

async function call(
  request: APIRequestContext,
  baseUrl: string,
  token: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  label: string,
  data?: JsonObject,
): Promise<APIResponse> {
  return request.fetch(`${baseUrl}${path}`, {
    method,
    headers: authHeaders(token, label, method !== 'GET'),
    ...(data === undefined ? {} : { data }),
    failOnStatusCode: false,
  })
}

async function jsonBody<T = JsonObject>(response: APIResponse): Promise<T> {
  const text = await response.text()
  return (text ? JSON.parse(text) : {}) as T
}

async function expectStatus(response: APIResponse, status: number, label: string): Promise<JsonObject> {
  const body = await jsonBody<JsonObject>(response)
  expect(response.status(), `${label}: ${JSON.stringify(body).slice(0, 600)}`).toBe(status)
  return body
}

function jwtPayload(token: string): Record<string, unknown> {
  const segments = token.split('.')
  expect(segments, 'P8 Function developer fixture must be a JWT').toHaveLength(3)
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'))
  } catch (error) {
    throw new Error(`P8 Function developer JWT payload is not valid JSON: ${String(error)}`)
  }
  expect(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'P8 Function developer JWT payload must be an object').toBeTruthy()
  return parsed as Record<string, unknown>
}

function expectP8FunctionActorClaims(actor: FunctionActorFixture): void {
  expect(actor.persona).toBe('P8')
  expect(actor.token).toBe(ENV.functionDeveloperToken)
  expect(actor.tenantId).toBe(ENV.tenantA)
  expect(actor.workspaceId).toBe(ENV.workspaceA)

  const claims = jwtPayload(actor.token)
  const realmAccess = claims.realm_access
  const roles = realmAccess && typeof realmAccess === 'object' && !Array.isArray(realmAccess)
    ? (realmAccess as Record<string, unknown>).roles
    : undefined
  expect(roles, 'P8 JWT realm_access.roles must be an array').toEqual(expect.any(Array))
  expect((roles as unknown[]).map(String), 'P8 JWT must carry the Function write role').toContain('workspace_developer')

  const workspaceIds = [
    ...(typeof claims.workspace_id === 'string' ? [claims.workspace_id] : []),
    ...(Array.isArray(claims.workspace_ids) ? claims.workspace_ids.map(String) : []),
    ...(typeof claims.workspace_ids === 'string' ? claims.workspace_ids.split(/[ ,]+/).filter(Boolean) : []),
  ]
  expect(workspaceIds, 'P8 JWT must be bound to the target workspace supplied by the fixture').toContain(actor.workspaceId)
  if (typeof claims.tenant_id === 'string') {
    expect(claims.tenant_id, 'P8 JWT tenant_id, when present, must match the target tenant fixture').toBe(actor.tenantId)
  }
}

async function expectFunctionMutationAccepted(
  response: APIResponse,
  label: string,
  expectedResourceId?: string,
): Promise<JsonObject> {
  const body = await expectGatewayMutationAccepted(response, label, 'functions', 'function_action')
  if (expectedResourceId !== undefined) expect(body.resourceId).toBe(expectedResourceId)
  return body
}

async function expectGatewayMutationAccepted(
  response: APIResponse,
  label: string,
  family: 'functions' | 'mcp',
  resourceType: 'function_action' | 'mcp_server',
): Promise<JsonObject> {
  const body = await expectStatus(response, 202, label)
  expect(Object.keys(body).sort(), `${label} must return exactly GatewayMutationAccepted`).toEqual([...GATEWAY_MUTATION_ACCEPTED_KEYS])
  expect(body).toMatchObject({
    status: 'accepted',
    family,
    resourceType,
    correlationId: correlation(label),
  })
  expect(body.requestId).toEqual(expect.any(String))
  expect(String(body.requestId).length).toBeGreaterThanOrEqual(8)
  expect(String(body.requestId).length).toBeLessThanOrEqual(128)
  expect(body.resourceId).toEqual(expect.any(String))
  expect(String(body.resourceId).length).toBeGreaterThan(0)
  expect(body.acceptedAt).toEqual(expect.any(String))
  expect(Number.isFinite(Date.parse(String(body.acceptedAt))), `${label} acceptedAt must be an RFC 3339 date-time`).toBeTruthy()
  return body
}

async function expectDeniedBeforeDependency(response: APIResponse, label: string): Promise<JsonObject> {
  const body = await jsonBody<JsonObject>(response)
  expect([403, 404], `${label}: ${JSON.stringify(body).slice(0, 500)}`).toContain(response.status())
  expect(JSON.stringify(body), `${label} must not disclose dependency state`).not.toMatch(/KNATIVE|READY|degraded|unavailable|runtimeDependency/i)
  return body
}

async function expectRpcDeniedBeforeDependency(response: APIResponse, label: string): Promise<JsonObject> {
  const body = await expectStatus(response, 200, label)
  expect((body.error as JsonObject | undefined)?.code).toBe(-32001)
  expect(JSON.stringify(body), `${label} must not disclose dependency state`).not.toMatch(/KNATIVE|READY|degraded|unavailable|runtimeDependency/i)
  return body
}

function expectUnavailable(body: JsonObject, expectedCorrelation: string): void {
  expect(body).toMatchObject({
    code: 'KNATIVE_UNAVAILABLE',
    message: 'Knative runtime is unavailable.',
    mode: 'managed',
    correlationId: expectedCorrelation,
  })
  expect(['unverified', 'degraded', 'unavailable']).toContain(body.state)
  expect(body.reason).toMatch(/^[A-Z][A-Z0-9_]{0,63}$/)
  expect(JSON.stringify(body)).not.toMatch(/ksvc|namespace|endpoint|token|secret|status\.json/i)
}

function expectRuntimeShape(status: RuntimeStatus): void {
  expect(['managed', 'external', 'disabled']).toContain(status.mode)
  expect(status.owner).toEqual(expect.any(String))
  expect(['compatible', 'incompatible', 'unverified']).toContain(status.compatibility)
  expect(['ready', 'unverified', 'degraded', 'unavailable', 'disabled']).toContain(status.state)
  expect(status.reason).toMatch(/^[A-Z][A-Z0-9_]{0,63}$/)
  expect(status.lastTransitionAt === null || !Number.isNaN(Date.parse(status.lastTransitionAt))).toBeTruthy()
}

async function getRuntime(request: APIRequestContext, baseUrl: string, token: string, label: string): Promise<RuntimeStatus> {
  const response = await call(request, baseUrl, token, 'GET', '/v1/platform/runtime/knative', label)
  const body = await expectStatus(response, 200, `${label} runtime status`) as RuntimeStatus & JsonObject
  expectRuntimeShape(body)
  return body
}

function parseCommand(name: LifecycleCommandName, target: VerifiedTarget): CommandSpec {
  let value: unknown
  try {
    value = JSON.parse(process.env[name] ?? '')
  } catch {
    throw new Error(`${name} must be a JSON argv array; shell command strings are rejected`)
  }
  if (!Array.isArray(value) || value.length === 0 || !value.every((part) => typeof part === 'string' && part.length > 0)) {
    throw new Error(`${name} must be a non-empty JSON array of non-empty strings`)
  }
  const [file, ...args] = value as string[]
  if (file !== ENV.chartLifecycleExecutable || basename(file) !== 'falcone-knative') {
    throw new Error(`${name} must invoke exactly E2E_933_CHART_LIFECYCLE_EXECUTABLE with basename falcone-knative`)
  }
  const expectedArgs = [
    'acceptance',
    LIFECYCLE_OPERATION[name],
    '--api-server', target.apiUrl,
    '--cluster-uid', target.clusterUid,
    '--infrastructure-name', target.infrastructureName,
    '--infrastructure-id', target.infrastructureId,
    '--run-id', target.runId,
    '--release', target.release,
    '--status-namespace', target.statusNamespace,
    '--status-configmap', target.statusConfigMap,
  ]
  if (args.length !== expectedArgs.length || args.some((part, index) => part !== expectedArgs[index])) {
    throw new Error(`${name} must use only the chart acceptance ${LIFECYCLE_OPERATION[name]} subcommand and exact verified target flags in the documented order`)
  }
  return { file, args }
}

function parseReplacementCommand(target: VerifiedTarget): CommandSpec {
  const name = 'E2E_933_MCP_REPLACEMENT_COMMAND_JSON'
  let value: unknown
  try { value = JSON.parse(process.env[name] ?? '') } catch { throw new Error(`${name} must be a JSON argv array`) }
  if (!Array.isArray(value) || !value.every((part) => typeof part === 'string' && part.length > 0)) {
    throw new Error(`${name} must be a non-empty JSON argv array`)
  }
  const [file, ...args] = value as string[]
  const expectedArgs = [
    'acceptance', 'replacement-conflict',
    '--api-server', target.apiUrl,
    '--cluster-uid', target.clusterUid,
    '--infrastructure-name', target.infrastructureName,
    '--infrastructure-id', target.infrastructureId,
    '--run-id', target.runId,
    '--release', target.release,
    '--status-namespace', target.statusNamespace,
    '--status-configmap', target.statusConfigMap,
  ]
  if (file !== ENV.chartLifecycleExecutable || basename(file) !== 'falcone-knative'
    || args.length !== expectedArgs.length || args.some((part, index) => part !== expectedArgs[index])) {
    throw new Error(`${name} must invoke the chart-owned replacement-conflict hook for the verified target`)
  }
  return { file, args }
}

async function armMcpReplacementConflict(target: VerifiedTarget, namespace: string, serverId: string): Promise<void> {
  const { file, args } = parseReplacementCommand(target)
  await verifyLifecycleExecutable(target)
  await execFileAsync(file, [
    ...args,
    '--namespace', namespace,
    '--resource-name', `mcp-${serverId}`,
    '--tenant-id', ENV.tenantA,
    '--workspace-id', ENV.workspaceA,
    '--server-id', serverId,
  ], { timeout: 10 * 60_000, maxBuffer: 1024 * 1024, env: process.env })
}

async function runLifecycleCommand(name: LifecycleCommandName, target: VerifiedTarget): Promise<void> {
  const { file, args } = parseCommand(name, target)
  await verifyLifecycleExecutable(target)
  try {
    await execFileAsync(file, args, {
      timeout: 10 * 60_000,
      maxBuffer: 1024 * 1024,
      env: process.env,
    })
  } catch (error) {
    const code = (error as { code?: string | number }).code ?? 'unknown'
    throw new Error(`${name} failed (exit/code ${String(code)}); command output is intentionally omitted because acceptance evidence may be sensitive`)
  }
}

async function verifyLifecycleExecutable(target: VerifiedTarget): Promise<void> {
  let binary: Buffer
  try {
    binary = await readFile(ENV.chartLifecycleExecutable)
  } catch {
    throw new Error('E2E_933_CHART_LIFECYCLE_EXECUTABLE is not a readable chart-installed falcone-knative binary')
  }
  const digest = createHash('sha256').update(binary).digest('hex')
  expect(digest, 'chart-installed falcone-knative binary must match the chart status/environment SHA-256').toBe(target.lifecycleSha256)
}

async function openshiftFetch(
  request: APIRequestContext,
  method: 'GET' | 'POST',
  path: string,
  data?: JsonObject,
): Promise<APIResponse> {
  return request.fetch(`${OPENSHIFT_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${ENV.openshiftToken}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    ...(data === undefined ? {} : { data }),
    failOnStatusCode: false,
  })
}

async function canCreateClusterResource(request: APIRequestContext, group: string, resource: string): Promise<void> {
  const response = await openshiftFetch(request, 'POST', '/apis/authorization.k8s.io/v1/selfsubjectaccessreviews', {
    apiVersion: 'authorization.k8s.io/v1',
    kind: 'SelfSubjectAccessReview',
    spec: { resourceAttributes: { group, resource, verb: 'create' } },
  })
  const body = await expectStatus(response, 201, `P18 create ${group}/${resource}`)
  expect((body.status as JsonObject | undefined)?.allowed, `P18 must have cluster-admin create authority for ${group}/${resource}`).toBe(true)
}

async function verifyClusterAdminIdentity(request: APIRequestContext): Promise<void> {
  const reviewResponse = await openshiftFetch(request, 'POST', '/apis/authentication.k8s.io/v1/selfsubjectreviews', {
    apiVersion: 'authentication.k8s.io/v1',
    kind: 'SelfSubjectReview',
  })
  const review = await expectStatus(reviewResponse, 201, 'P18 SelfSubjectReview')
  const userInfo = (review.status as JsonObject | undefined)?.userInfo as JsonObject | undefined
  const username = String(userInfo?.username ?? '')
  const groups = Array.isArray(userInfo?.groups) ? userInfo.groups.map(String) : []
  expect(username, 'SelfSubjectReview user must match the explicitly attested cluster-admin subject').toBe(ENV.expectedClusterAdminUser)

  const bindings = await listClusterResources(request, '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings')
  const matchingBinding = bindings.find((binding) => {
    const roleRef = binding.roleRef as JsonObject | undefined
    if (roleRef?.apiGroup !== 'rbac.authorization.k8s.io' || roleRef?.kind !== 'ClusterRole' || roleRef?.name !== 'cluster-admin') return false
    const subjects = Array.isArray(binding.subjects) ? binding.subjects as JsonObject[] : []
    return subjects.some((subject) => (
      (subject.kind === 'User' && subject.name === username)
      || (subject.kind === 'Group' && groups.includes(String(subject.name)))
    ))
  })
  const systemMastersEquivalent = groups.includes('system:masters')
  expect(
    systemMastersEquivalent || Boolean(matchingBinding),
    `SelfSubjectReview identity ${username} (${groups.join(',')}) must belong to system:masters or be a live subject of a ClusterRoleBinding to ClusterRole cluster-admin`,
  ).toBeTruthy()
}

async function verifyLiveTargetIdentity(request: APIRequestContext): Promise<VerifiedTarget> {
  const infrastructureResponse = await openshiftFetch(request, 'GET', '/apis/config.openshift.io/v1/infrastructures/cluster')
  const infrastructure = await expectStatus(infrastructureResponse, 200, 'OpenShift Infrastructure identity')
  const infrastructureName = String((infrastructure.metadata as JsonObject | undefined)?.name ?? '')
  const infrastructureId = String((infrastructure.status as JsonObject | undefined)?.infrastructureName ?? '')
  expect(infrastructureName).toBe(ENV.expectedInfrastructureName)
  expect(infrastructureId).toBe(ENV.expectedInfrastructureId)

  const kubeSystemResponse = await openshiftFetch(request, 'GET', '/api/v1/namespaces/kube-system')
  const kubeSystem = await expectStatus(kubeSystemResponse, 200, 'kube-system cluster UID')
  const clusterUid = String((kubeSystem.metadata as JsonObject | undefined)?.uid ?? '')
  expect(clusterUid).toBe(ENV.expectedClusterUid)

  const attestation = parseDisposableAttestation()
  expect(attestation, 'a valid disposable-target attestation is mandatory').not.toBeNull()
  expect(attestation).toMatchObject({
    runId: RUN_ID,
    apiUrl: OPENSHIFT_API,
    infrastructureName,
    infrastructureId,
    clusterUid,
  })
  const remainingMs = Date.parse(attestation!.expiresAt) - Date.now()
  expect(remainingMs, 'disposable-target attestation must remain valid for at least five minutes').toBeGreaterThanOrEqual(5 * 60_000)
  expect(remainingMs, 'disposable-target attestation must expire within 72 hours').toBeLessThanOrEqual(72 * 60 * 60_000)

  return {
    apiUrl: OPENSHIFT_API,
    runId: RUN_ID,
    infrastructureName,
    infrastructureId,
    clusterUid,
    release: ENV.chartRelease,
    chartVersion: ENV.chartVersion,
    statusNamespace: ENV.chartStatusNamespace,
    statusConfigMap: ENV.chartStatusConfigMap,
    lifecycleSha256: ENV.chartLifecycleSha256,
  }
}

async function verifyChartLifecycleStatus(request: APIRequestContext, target: VerifiedTarget): Promise<void> {
  const response = await openshiftFetch(
    request,
    'GET',
    `/api/v1/namespaces/${encodeURIComponent(target.statusNamespace)}/configmaps/${encodeURIComponent(target.statusConfigMap)}`,
  )
  const configMap = await expectStatus(response, 200, 'chart #8 lifecycle status ConfigMap')
  const metadata = configMap.metadata as JsonObject | undefined
  const labels = metadata?.labels as JsonObject | undefined
  const annotations = metadata?.annotations as JsonObject | undefined
  expect(labels?.['app.kubernetes.io/managed-by']).toBe('Helm')
  expect(labels?.['app.kubernetes.io/instance']).toBe(target.release)
  expect(labels?.['app.kubernetes.io/version']).toBe(target.chartVersion)
  expect(annotations?.['meta.helm.sh/release-name']).toBe(target.release)
  expect(annotations?.['meta.helm.sh/release-namespace']).toBe(target.statusNamespace)

  const data = configMap.data as JsonObject | undefined
  const rawStatus = data?.[ENV.chartStatusDataKey]
  expect(typeof rawStatus, `ConfigMap data.${ENV.chartStatusDataKey} must contain chart lifecycle JSON`).toBe('string')
  let status: JsonObject
  try {
    status = JSON.parse(String(rawStatus)) as JsonObject
  } catch {
    throw new Error(`ConfigMap data.${ENV.chartStatusDataKey} is not valid JSON`)
  }
  expect(status).toMatchObject({
    schemaVersion: 'falcone.knative-lifecycle/v1',
    release: target.release,
    version: target.chartVersion,
    status: 'compatible',
    runId: target.runId,
    clusterIdentity: {
      apiUrl: target.apiUrl,
      infrastructureName: target.infrastructureName,
      infrastructureId: target.infrastructureId,
      clusterUid: target.clusterUid,
    },
    lifecycleExecutable: {
      name: 'falcone-knative',
      version: target.chartVersion,
      sha256: target.lifecycleSha256,
    },
  })
}

async function listClusterResources(request: APIRequestContext, path: string): Promise<JsonObject[]> {
  const response = await openshiftFetch(request, 'GET', path)
  const body = await expectStatus(response, 200, `cluster inventory ${path}`)
  return Array.isArray(body.items) ? body.items as JsonObject[] : []
}

async function loginAs(page: Page, username: string, password: string, exactRole: string): Promise<void> {
  await page.goto(`${MANAGED_CONSOLE}/login`)
  await page.locator('input[name="username"]').fill(username)
  await page.locator('input[name="password"]').fill(password)
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().includes('/v1/auth/login-sessions') && candidate.request().method() === 'POST'),
    page.locator('button[type="submit"]').click(),
  ])
  expect(response.ok(), `console login for exact role ${exactRole}`).toBeTruthy()
  const roles = await page.evaluate(() => {
    for (const store of [localStorage, sessionStorage]) {
      const raw = store.getItem('in-falcone.console-shell-session')
      if (!raw) continue
      try {
        const parsed = JSON.parse(raw)
        return parsed?.principal?.platformRoles ?? []
      } catch {
        return []
      }
    }
    return []
  })
  expect(roles, `${username} must be a constrained exact-role fixture`).toEqual([exactRole])
}

async function loginWithCredentials(page: Page, username: string, password: string): Promise<void> {
  await page.goto(`${MANAGED_CONSOLE}/login`)
  await page.locator('input[name="username"]').fill(username)
  await page.locator('input[name="password"]').fill(password)
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().includes('/v1/auth/login-sessions') && candidate.request().method() === 'POST'),
    page.locator('button[type="submit"]').click(),
  ])
  expect(response.ok(), `console login for ${username}`).toBeTruthy()
}

function functionBody(tenantId: string, workspaceId: string, version: 'one' | 'two'): JsonObject {
  return {
    tenantId,
    workspaceId,
    actionName: SAME_NAME,
    source: {
      kind: 'inline_code',
      language: 'javascript',
      entryFile: 'index.js',
      inlineCode: `module.exports.main = async (params) => ({ version: '${version}', tenantEcho: params.tenantEcho ?? null })`,
    },
    execution: {
      runtime: 'nodejs:20',
      entrypoint: 'main',
      parameters: {},
      environment: {},
      limits: { memoryMb: 256, timeoutSeconds: 60 },
      webAction: { enabled: false, requireAuthentication: true, rawHttpResponse: false },
    },
    activationPolicy: {
      logsAccess: 'workspace_developers',
      resultAccess: 'workspace_developers',
      rerunPolicy: 'manual_only',
      retentionHours: 24,
    },
  }
}

async function createFunction(
  request: APIRequestContext,
  actor: FunctionActorFixture,
  suffix: string,
): Promise<string> {
  const label = `function-create-${suffix}`
  const response = await call(request, MANAGED_API, actor.token, 'POST', '/v1/functions/actions', label, functionBody(actor.tenantId, actor.workspaceId, 'one'))
  const body = await expectFunctionMutationAccepted(response, label)
  return String(body.resourceId)
}

async function createMcp(request: APIRequestContext, token: string, workspaceId: string, suffix: string): Promise<string> {
  const response = await call(request, MANAGED_API, token, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(workspaceId)}/servers`, `mcp-create-${suffix}`, {
    name: SAME_NAME,
    source: 'instant',
    generator: 'postgres',
  })
  const body = await expectGatewayMutationAccepted(response, `mcp-create-${suffix}`, 'mcp', 'mcp_server')
  return String(body.resourceId)
}

async function deleteBestEffort(request: APIRequestContext, token: string, path: string, label: string): Promise<void> {
  await call(request, MANAGED_API, token, 'DELETE', path, label).catch(() => undefined)
}

test.describe('issue #933 local kind contract/regression only (never OpenShift acceptance)', () => {
  test.skip(process.env.E2E_933_LOCAL_REGRESSION !== '1', 'Set E2E_933_LOCAL_REGRESSION=1 for the honestly labelled kind contract subset; this does not satisfy OpenShift acceptance.')

  test('issue-933-local-contract | fn-managed-knative-runtime-status: public schema and auth are stable', async ({ request }) => {
    const token = process.env.E2E_933_LOCAL_OPERATOR_TOKEN ?? ''
    const expectedMode = process.env.E2E_933_LOCAL_EXPECTED_MODE as RuntimeMode | undefined
    test.skip(!token || !expectedMode, 'Local contract subset requires E2E_933_LOCAL_OPERATOR_TOKEN and E2E_933_LOCAL_EXPECTED_MODE; it never claims managed OpenShift acceptance.')

    const status = await getRuntime(request, MANAGED_API, token, 'local-contract')
    expect(status.mode).toBe(expectedMode)

    const unauthenticated = await request.get(`${MANAGED_API}/v1/platform/runtime/knative`, {
      headers: { 'x-api-version': API_VERSION, 'x-correlation-id': correlation('local-unauthenticated') },
      failOnStatusCode: false,
    })
    expect(unauthenticated.status()).toBe(401)
  })
})

test.describe('issue #933 remote OpenShift 4.21 managed runtime acceptance', () => {
  test.describe.configure({ mode: 'serial', timeout: 12 * 60_000 })
  test.skip(missingAcceptance.length > 0, acceptanceSkipReason)

  let functionA = ''
  let functionB = ''
  let mcpA = ''
  let mcpB = ''
  let mcpAHostedTool = ''
  let mcpConflict = ''
  let activationA = ''
  let rollbackVersionA = ''
  let activeVersionBeforeOutage = ''
  let functionDeleteCorrelation = ''
  let mcpDeleteCorrelation = ''
  let outageApplied = false
  let baselineFunctionKsvcs: string[] = []
  let verifiedTarget: VerifiedTarget | null = null

  test.afterAll(async ({ request }) => {
    // Recovery and public-API deletion are best-effort fallback cleanup for an assertion failure.
    // The successful path proves cleanup explicitly in the final scenario.
    if (outageApplied && verifiedTarget) await runLifecycleCommand('E2E_933_RECOVERY_COMMAND_JSON', verifiedTarget).catch(() => undefined)
    if (functionA) await deleteBestEffort(request, P8_FUNCTION_ACTOR.token, `/v1/functions/actions/${encodeURIComponent(functionA)}`, 'fallback-function-a')
    if (functionB) await deleteBestEffort(request, ENV.tenantBToken, `/v1/functions/actions/${encodeURIComponent(functionB)}`, 'fallback-function-b')
    if (mcpA) await deleteBestEffort(request, ENV.mcpOwnerToken, `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}`, 'fallback-mcp-a')
    if (mcpB) await deleteBestEffort(request, ENV.tenantBToken, `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceB)}/servers/${encodeURIComponent(mcpB)}`, 'fallback-mcp-b')
    if (mcpConflict) await deleteBestEffort(request, ENV.mcpOwnerToken, `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpConflict)}`, 'fallback-mcp-conflict')
  })

  test('issue-933-01 | P18/P3: remote OpenShift 4.21 cluster-admin and chart #8 compatible managed status are real', async ({ request }) => {
    expect(process.env.E2E_933_CHART_ISSUE8_STATUS).toBe('compatible')
    expect(ENV.chartRelease).toMatch(/\S/)
    expect(ENV.chartVersion).toMatch(/\S/)
    expect(RUN_ID_INPUT).toBe(RUN_ID)
    expect(remoteApiError(OPENSHIFT_API)).toBeNull()

    const versionResponse = await openshiftFetch(request, 'GET', '/version')
    const version = await expectStatus(versionResponse, 200, 'OpenShift Kubernetes version')
    expect(version.gitVersion).toMatch(/^v1\.34(?:\.|$)/)

    const clusterVersionResponse = await openshiftFetch(request, 'GET', '/apis/config.openshift.io/v1/clusterversions/version')
    const clusterVersion = await expectStatus(clusterVersionResponse, 200, 'OpenShift ClusterVersion')
    const desiredVersion = (clusterVersion.status as JsonObject | undefined)?.desiredVersion as JsonObject | undefined
    expect(desiredVersion?.version).toMatch(/^4\.21(?:\.|$)/)

    verifiedTarget = await verifyLiveTargetIdentity(request)
    await verifyClusterAdminIdentity(request)
    await canCreateClusterResource(request, 'apiextensions.k8s.io', 'customresourcedefinitions')
    await canCreateClusterResource(request, 'rbac.authorization.k8s.io', 'clusterroles')
    await canCreateClusterResource(request, 'admissionregistration.k8s.io', 'validatingwebhookconfigurations')
    await verifyChartLifecycleStatus(request, verifiedTarget)
    await verifyLifecycleExecutable(verifiedTarget)

    const managed = await getRuntime(request, MANAGED_API, ENV.operatorToken, 'managed-ready')
    expect(managed).toMatchObject({
      mode: 'managed',
      compatibility: 'compatible',
      state: 'ready',
      reason: 'READY',
      version: '1.22.1',
    })
    expect(managed.owner).not.toMatch(/^(unknown|external|none)?$/i)
    expect(managed.lastTransitionAt).not.toBeNull()

    baselineFunctionKsvcs = (await listClusterResources(
      request,
      `/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(ENV.appNamespace)}/services?labelSelector=${encodeURIComponent('in-falcone.function=true')}`,
    )).map((item) => String((item.metadata as JsonObject | undefined)?.name ?? '')).filter(Boolean)
  })

  test('issue-933-02 | P3/P10: exact platform roles see the same read-only status in UI/API; all other roles are denied', async ({ browser, request }) => {
    for (const [role, token] of [
      ['platform_operator', ENV.operatorToken],
      ['platform_auditor', ENV.auditorToken],
      ['platform_admin', ENV.adminToken],
      ['superadmin', ENV.superadminToken],
    ] as const) {
      const status = await getRuntime(request, MANAGED_API, token, `status-${role}`)
      expect(status.mode).toBe('managed')
    }

    const denied = await call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'GET', '/v1/platform/runtime/knative', 'status-tenant-denied')
    expect(denied.status()).toBe(403)
    expect(JSON.stringify(await jsonBody(denied))).not.toMatch(/owner|version|READY|degraded|unavailable/i)

    const unauthenticated = await request.get(`${MANAGED_API}/v1/platform/runtime/knative`, {
      headers: { 'x-api-version': API_VERSION, 'x-correlation-id': correlation('status-unauthenticated') },
      failOnStatusCode: false,
    })
    expect(unauthenticated.status()).toBe(401)

    for (const [label, token] of [
      ['tenant-realm-copied-operator', ENV.tenantRealmOperatorToken],
      ['tenant-realm-copied-auditor', ENV.tenantRealmAuditorToken],
    ] as const) {
      const copiedRole = await call(request, MANAGED_API, token, 'GET', '/v1/platform/runtime/knative', `status-${label}`)
      await expectDeniedBeforeDependency(copiedRole, `status ${label}`)
    }

    for (const persona of [
      { role: 'platform_operator', username: ENV.operatorUser, password: ENV.operatorPassword },
      { role: 'platform_auditor', username: ENV.auditorUser, password: ENV.auditorPassword },
    ]) {
      const context = await browser.newContext()
      const page = await context.newPage()
      await loginAs(page, persona.username, persona.password, persona.role)
      const statusRequest = page.waitForRequest((candidate) => candidate.url().endsWith('/v1/platform/runtime/knative'))
      await page.goto(`${MANAGED_CONSOLE}/console/runtime`)
      expect((await statusRequest).headers().authorization).toMatch(/^Bearer\s+\S+/)
      await expect(page).toHaveTitle(/Runtime de funciones/)
      await expect(page.locator('main')).toHaveCount(1)
      await expect(page.getByRole('link', { name: 'Runtime de funciones' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Runtime de funciones' })).toBeVisible()
      await expect(page.getByText('Plataforma · solo lectura')).toBeVisible()
      await expect(page.getByText('Gestionado por la plataforma')).toBeVisible()
      await expect(page.getByLabel('Estado del runtime: Listo')).toBeVisible()
      const retry = page.getByRole('button', { name: 'Volver a comprobar' })
      await retry.focus()
      await retry.click()
      await expect(page.getByText('Consultando runtime de plataforma')).toBeVisible()
      await expect(retry).toBeVisible()
      await expect(retry).toBeFocused()
      await expect(page.getByRole('status')).toContainText('Estado actualizado: Listo.')
      await expect(page.getByRole('button', { name: /crear|instalar|cambiar|actualizar|eliminar|rollback|revertir/i })).toHaveCount(0)
      await context.close()
    }
  })

  test('issue-933-03 | P18/P10: external and disabled remain distinct, observational, and fail closed', async ({ request }) => {
    const external = await getRuntime(request, EXTERNAL_API, ENV.externalOperatorToken, 'external-status')
    expect(external.mode).toBe('external')
    expect(external.owner).not.toMatch(/falcone-managed/i)
    expect(external.stage).toBe('external_validation')
    expect(['ready', 'unverified']).toContain(external.state)

    const disabled = await getRuntime(request, DISABLED_API, ENV.disabledOperatorToken, 'disabled-status')
    expect(disabled).toMatchObject({
      mode: 'disabled',
      state: 'disabled',
      reason: 'RUNTIME_DISABLED',
    })

    const disabledCreate = await call(
      request,
      DISABLED_API,
      ENV.disabledTenantToken,
      'POST',
      '/v1/functions/actions',
      'disabled-function-create',
      functionBody(ENV.tenantA, ENV.workspaceA, 'one'),
    )
    const disabledBody = await expectStatus(disabledCreate, 501, 'disabled Function create')
    expect(disabledBody).toMatchObject({ code: 'FUNCTIONS_DISABLED', message: 'Functions capability is disabled.' })
    expect(JSON.stringify(disabledBody)).not.toContain('KNATIVE_UNAVAILABLE')
  })

  test('issue-933-04 | P8/P13: adjacent tenants deploy and invoke same-name Functions without collision', async ({ request }) => {
    expectP8FunctionActorClaims(P8_FUNCTION_ACTOR)
    functionA = await createFunction(request, P8_FUNCTION_ACTOR, 'tenant-a')
    functionB = await createFunction(request, P13_FUNCTION_ACTOR, 'tenant-b')
    expect(functionA).not.toBe(functionB)

    for (const [token, resourceId, tenantEcho, label] of [
      [P8_FUNCTION_ACTOR.token, functionA, 'A', 'a'],
      [ENV.tenantBToken, functionB, 'B', 'b'],
    ]) {
      const invoke = await call(request, MANAGED_API, token, 'POST', `/v1/functions/actions/${encodeURIComponent(resourceId)}/invocations`, `function-invoke-${label}`, {
        parameters: { tenantEcho },
        triggerContext: { kind: 'direct', correlationKey: correlation(`function-invoke-${label}`) },
        responseMode: 'wait_for_result',
        idempotencyScope: 'request',
      })
      const body = await expectStatus(invoke, 202, `Function invoke ${label}`)
      expect(body.status).toBe('completed')
      if (label === 'a') activationA = String(body.invocationId)
    }


    expect(activationA).toMatch(/^act_/)
    const activations = await call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}/activations`, 'function-activations-a')
    const activationItems = (await expectStatus(activations, 200, 'Function activations A')).items as JsonObject[]
    expect(activationItems.some((item) => item.activationId === activationA)).toBe(true)
    const activation = await call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}/activations/${encodeURIComponent(activationA)}`, 'function-activation-a')
    expect((await expectStatus(activation, 200, 'Function activation A')).activationId).toBe(activationA)
    const logs = await call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}/activations/${encodeURIComponent(activationA)}/logs`, 'function-logs-a')
    expect((await expectStatus(logs, 200, 'Function logs A')).lines).toEqual(expect.any(Array))
    const result = await call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}/activations/${encodeURIComponent(activationA)}/result`, 'function-result-a')
    expect(await expectStatus(result, 200, 'Function result A')).toMatchObject({
      activationId: activationA,
      status: 'succeeded',
      result: { version: 'one', tenantEcho: 'A' },
    })

    const foreign = await call(request, MANAGED_API, ENV.tenantBToken, 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}`, 'function-foreign-read')
    expect([403, 404]).toContain(foreign.status())
    expect(JSON.stringify(await jsonBody(foreign))).not.toMatch(/KNATIVE|READY|degraded|unavailable|tenant-a/i)

    const functionKsvcs = await listClusterResources(
      request,
      `/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(ENV.appNamespace)}/services?labelSelector=${encodeURIComponent('in-falcone.function=true')}`,
    )
    const createdNames = functionKsvcs.map((item) => String((item.metadata as JsonObject | undefined)?.name ?? '')).filter((name) => name && !baselineFunctionKsvcs.includes(name))
    expect(new Set(createdNames).size, 'same-name adjacent Functions must own distinct ksvcs').toBeGreaterThanOrEqual(2)
  })

  test('issue-933-05 | P8: update creates a version, invocation uses it, and rollback restores the prior version', async ({ request }) => {
    expectP8FunctionActorClaims(P8_FUNCTION_ACTOR)
    const updateLabel = 'function-update-a'
    const update = await call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'PATCH', `/v1/functions/actions/${encodeURIComponent(functionA)}`, updateLabel, functionBody(P8_FUNCTION_ACTOR.tenantId, P8_FUNCTION_ACTOR.workspaceId, 'two'))
    await expectFunctionMutationAccepted(update, updateLabel, functionA)

    const invokeUpdated = await call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'POST', `/v1/functions/actions/${encodeURIComponent(functionA)}/invocations`, 'function-invoke-updated-a', {
      parameters: { tenantEcho: 'A-v2' }, responseMode: 'wait_for_result', idempotencyScope: 'request',
    })
    const updatedInvocation = await expectStatus(invokeUpdated, 202, 'updated Function invoke')
    const updatedResult = await call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}/activations/${encodeURIComponent(String(updatedInvocation.invocationId))}/result`, 'function-result-updated-a')
    expect(await expectStatus(updatedResult, 200, 'updated Function result')).toMatchObject({ result: { version: 'two', tenantEcho: 'A-v2' } })

    const versionsResponse = await call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}/versions`, 'function-versions-a')
    const versionsBody = await expectStatus(versionsResponse, 200, 'Function versions')
    const versions = versionsBody.items as JsonObject[]
    expect(versions).toHaveLength(2)
    const rollbackTarget = versions.find((item) => item.rollbackEligible === true)
    const active = versions.find((item) => item.status === 'active')
    expect(rollbackTarget?.versionId).toEqual(expect.any(String))
    expect(active?.versionId).toEqual(expect.any(String))
    rollbackVersionA = String(rollbackTarget?.versionId)
    activeVersionBeforeOutage = String(active?.versionId)

    const rollback = await call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'POST', `/v1/functions/actions/${encodeURIComponent(functionA)}/rollback`, 'function-rollback-a', {
      versionId: rollbackVersionA,
      reason: 'Issue #933 managed-runtime acceptance rollback',
    })
    const rollbackBody = await expectStatus(rollback, 202, 'Function rollback')
    expect(rollbackBody.requestedVersionId).toBe(rollbackVersionA)

    const detail = await call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}`, 'function-detail-after-rollback')
    const detailBody = await expectStatus(detail, 200, 'Function detail after rollback')
    expect(detailBody.activeVersionId).toBe(rollbackVersionA)

    const invokeRolledBack = await call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'POST', `/v1/functions/actions/${encodeURIComponent(functionA)}/invocations`, 'function-invoke-rolled-back-a', {
      parameters: { tenantEcho: 'A-rollback' }, responseMode: 'wait_for_result', idempotencyScope: 'request',
    })
    const rolledBackInvocation = await expectStatus(invokeRolledBack, 202, 'rolled-back Function invoke')
    const rolledBackResult = await call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}/activations/${encodeURIComponent(String(rolledBackInvocation.invocationId))}/result`, 'function-result-rolled-back-a')
    expect(await expectStatus(rolledBackResult, 200, 'rolled-back Function result')).toMatchObject({ result: { version: 'one', tenantEcho: 'A-rollback' } })
  })

  test('issue-933-06 | P7/P12/P13: same-name hosted MCP publish/activate/JSON-RPC and isolation work', async ({ request }) => {
    mcpA = await createMcp(request, ENV.mcpOwnerToken, ENV.workspaceA, 'tenant-a')
    mcpB = await createMcp(request, ENV.tenantBToken, ENV.workspaceB, 'tenant-b')
    expect(mcpA).not.toBe(mcpB)

    for (const [token, workspaceId, serverId, label] of [
      [ENV.mcpOwnerToken, ENV.workspaceA, mcpA, 'a'],
      [ENV.tenantBToken, ENV.workspaceB, mcpB, 'b'],
    ]) {
      const publish = await call(request, MANAGED_API, token, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(workspaceId)}/servers/${encodeURIComponent(serverId)}/versions`, `mcp-publish-${label}`, { version: 'v1' })
      expect((await expectStatus(publish, 201, `MCP publish ${label}`)).version ?? 'v1').toBeTruthy()
      const activate = await call(request, MANAGED_API, token, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(workspaceId)}/servers/${encodeURIComponent(serverId)}/versions/v1/approval`, `mcp-activate-${label}`)
      await expectStatus(activate, 200, `MCP activate ${label}`)
    }

    const listTools = await call(request, MANAGED_API, ENV.mcpConsumerToken, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}/rpc`, 'mcp-tools-list-ready', {
      jsonrpc: '2.0',
      id: 93301,
      method: 'tools/list',
      params: {},
    })
    const listBody = await expectStatus(listTools, 200, 'MCP tools/list ready')
    expect(listBody).toMatchObject({ jsonrpc: '2.0', id: 93301 })
    const tools = (listBody.result as JsonObject).tools as JsonObject[]
    expect(tools.length).toBeGreaterThan(0)
    mcpAHostedTool = String(tools[0].name)

    const hostedCall = await call(request, MANAGED_API, ENV.mcpConsumerToken, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}/tool-calls`, 'mcp-hosted-tool-call-ready', {
      name: mcpAHostedTool,
      arguments: { workspaceId: ENV.workspaceA },
    })
    const hostedCallBody = await expectStatus(hostedCall, 200, 'MCP hosted tool call ready')
    expect(hostedCallBody.isError).toBe(false)
    expect(hostedCallBody.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text' })]))
    expect(JSON.stringify(hostedCallBody), 'hosted call must not wrap downstream authentication failure as success').not.toMatch(
      /(?:HTTP(?:_STATUS)?\s*[:=]?\s*401|\b401\s+Unauthorized\b|UNAUTHORIZED|UNAUTHENTICATED|Missing token|delegated credential required)/i,
    )

    const foreign = await call(request, MANAGED_API, ENV.tenantBToken, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}/rpc`, 'mcp-foreign-ready', {
      jsonrpc: '2.0', id: 93302, method: 'ping', params: {},
    })
    expect([403, 404, 200]).toContain(foreign.status())
    const foreignBody = await jsonBody(foreign)
    if (foreign.status() === 200) expect((foreignBody.error as JsonObject).code).toBe(-32001)
    expect(JSON.stringify(foreignBody)).not.toMatch(/KNATIVE|READY|degraded|unavailable|tenant-a/i)

    for (const [namespace, tenantId, serverId] of [[ENV.mcpNamespaceA, ENV.tenantA, mcpA], [ENV.mcpNamespaceB, ENV.tenantB, mcpB]]) {
      const ksvc = await openshiftFetch(request, 'GET', `/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(namespace)}/services/${encodeURIComponent(`mcp-${serverId}`)}`)
      const ksvcBody = await expectStatus(ksvc, 200, `hosted MCP ${serverId} must own a real Knative Service`)
      expect((ksvcBody.metadata as JsonObject).labels).toMatchObject({
        'in-falcone.io/tenant': tenantId,
        'in-falcone.io/mcp-server': serverId,
      })
    }
  })

  /**
   * bbx-933-mcp-cold-start-tool-55 | fn-mcp-hosted-invoke
   * OpenSpec #### Scenario: Idle server scales down and cold-starts
   */
  test('issue-933-07 | P3/P12: hosted MCP scales to zero and a real published tool cold-starts it', async ({ request }) => {
    const podsPath = `/api/v1/namespaces/${encodeURIComponent(ENV.mcpNamespaceA)}/pods?labelSelector=${encodeURIComponent(`serving.knative.dev/service=mcp-${mcpA}`)}`
    await expect.poll(async () => (await listClusterResources(request, podsPath)).length, {
      message: 'hosted MCP should scale to zero without a fixed sleep',
      timeout: Number(process.env.E2E_933_SCALE_TO_ZERO_TIMEOUT_MS ?? 10 * 60_000),
      intervals: [1_000, 2_000, 5_000, 10_000],
    }).toBe(0)

    expect(mcpAHostedTool, 'the previously published hosted tool contract must survive scale-to-zero').toMatch(/\S/)
    const toolCall = await call(request, MANAGED_API, ENV.mcpConsumerToken, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}/rpc`, 'mcp-cold-start-tool', {
      jsonrpc: '2.0', id: 93303, method: 'tools/call',
      params: { name: mcpAHostedTool, arguments: { workspaceId: ENV.workspaceA } },
    })
    const toolBody = await expectStatus(toolCall, 200, 'MCP cold-start hosted tools/call')
    expect(toolBody).toMatchObject({ jsonrpc: '2.0', id: 93303 })
    expect(toolBody.error, `cold-started hosted tool returned JSON-RPC error: ${JSON.stringify(toolBody)}`).toBeUndefined()
    const result = toolBody.result as JsonObject
    expect(result?.isError, `cold-started hosted tool reported failure: ${JSON.stringify(toolBody)}`).toBe(false)
    expect(result?.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text' })]))
    expect(JSON.stringify(result), 'downstream HTTP authorization failures must not be encapsulated as MCP success').not.toMatch(
      /(?:HTTP(?:_STATUS)?\s*[:=]?\s*401|\b401\s+Unauthorized\b|UNAUTHORIZED|UNAUTHENTICATED|Missing token|delegated credential required)/i,
    )
    await expect.poll(async () => (await listClusterResources(request, podsPath)).length, {
      message: 'the successful hosted tools/call must cold-start at least one pod for the same Knative Service',
      timeout: Number(process.env.E2E_933_COLD_START_READY_TIMEOUT_MS ?? 2 * 60_000),
      intervals: [500, 1_000, 2_000, 5_000],
    }).toBeGreaterThan(0)
  })

  test('issue-933-07b | P7/P18: replacement conflict retains MCP ownership and replay safely removes the replacement', async ({ request }) => {
    expect(verifiedTarget, 'live target identity must be verified before the chart acceptance hook runs').not.toBeNull()
    mcpConflict = await createMcp(request, ENV.mcpOwnerToken, ENV.workspaceA, 'replacement-conflict')
    const publish = await call(request, MANAGED_API, ENV.mcpOwnerToken, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpConflict)}/versions`, 'mcp-conflict-publish', { version: 'v1' })
    await expectStatus(publish, 201, 'replacement-conflict MCP publish')
    await armMcpReplacementConflict(verifiedTarget!, ENV.mcpNamespaceA, mcpConflict)

    const firstDelete = await call(request, MANAGED_API, ENV.mcpOwnerToken, 'DELETE', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpConflict)}`, 'mcp-conflict-delete-first')
    expect(await expectStatus(firstDelete, 202, 'replacement-conflict first delete')).toMatchObject({ status: 'deletion_pending' })
    const retained = await call(request, MANAGED_API, ENV.mcpOwnerToken, 'GET', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpConflict)}`, 'mcp-conflict-retained')
    expect(await expectStatus(retained, 200, 'replacement-conflict retained detail')).toMatchObject({ lifecycleStatus: 'deletion_pending' })

    const replay = await call(request, MANAGED_API, ENV.mcpOwnerToken, 'DELETE', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpConflict)}`, 'mcp-conflict-delete-replay')
    expect([200, 204]).toContain(replay.status())
    await expect.poll(async () => (await call(request, MANAGED_API, ENV.mcpOwnerToken, 'GET', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpConflict)}`, 'mcp-conflict-gone')).status()).toBe(404)
    mcpConflict = ''
  })

  test('issue-933-08 | P3/P8/P7/P12/P13: outage contracts are exact and tenant-safe', async ({ browser, request }) => {
    expectP8FunctionActorClaims(P8_FUNCTION_ACTOR)
    expect(verifiedTarget, 'live target identity must be verified before outage').not.toBeNull()
    await runLifecycleCommand('E2E_933_OUTAGE_COMMAND_JSON', verifiedTarget!)
    outageApplied = true

    await expect.poll(async () => (await getRuntime(request, MANAGED_API, ENV.operatorToken, 'outage-poll')).state, {
      message: 'chart status must close the Falcone workload gate',
      timeout: 5 * 60_000,
      intervals: [500, 1_000, 2_000, 5_000],
    }).not.toBe('ready')

    const wrongClaims = jwtPayload(ENV.sameTenantWrongWorkspaceToken)
    if (typeof wrongClaims.tenant_id === 'string') expect(wrongClaims.tenant_id).toBe(ENV.tenantA)
    else expect(String(wrongClaims.iss ?? '').split('/').filter(Boolean).at(-1)).toBe(ENV.tenantA)
    expect([
      ...(typeof wrongClaims.workspace_id === 'string' ? [wrongClaims.workspace_id] : []),
      ...(Array.isArray(wrongClaims.workspace_ids) ? wrongClaims.workspace_ids.map(String) : []),
    ]).not.toContain(ENV.workspaceA)

    const wrongWorkspaceFunctionRequests: Array<[string, 'GET' | 'POST' | 'PATCH' | 'DELETE', string, JsonObject | undefined]> = [
      ['detail', 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}`, undefined],
      ['versions', 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}/versions`, undefined],
      ['activations', 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}/activations`, undefined],
      ['activation', 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}/activations/${encodeURIComponent(activationA)}`, undefined],
      ['logs', 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}/activations/${encodeURIComponent(activationA)}/logs`, undefined],
      ['result', 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}/activations/${encodeURIComponent(activationA)}/result`, undefined],
      ['invoke', 'POST', `/v1/functions/actions/${encodeURIComponent(functionA)}/invocations`, { parameters: {}, responseMode: 'accepted' }],
      ['update', 'PATCH', `/v1/functions/actions/${encodeURIComponent(functionA)}`, functionBody(ENV.tenantA, ENV.workspaceA, 'two')],
      ['rollback', 'POST', `/v1/functions/actions/${encodeURIComponent(functionA)}/rollback`, { versionId: rollbackVersionA }],
      ['delete', 'DELETE', `/v1/functions/actions/${encodeURIComponent(functionA)}`, undefined],
      ['create', 'POST', '/v1/functions/actions', { ...functionBody(ENV.tenantA, ENV.workspaceA, 'one'), actionName: `${SAME_NAME}-wrong-workspace` }],
    ]
    for (const [operation, method, path, data] of wrongWorkspaceFunctionRequests) {
      const response = await call(request, MANAGED_API, ENV.sameTenantWrongWorkspaceToken, method, path, `wrong-workspace-function-${operation}`, data)
      await expectDeniedBeforeDependency(response, `same-tenant wrong-workspace Function ${operation}`)
    }

    for (const [actor, token] of [
      ['tenant-owner-only', ENV.tenantOwnerOnlyToken],
      ['tenant-admin-only', ENV.tenantAdminOnlyToken],
      ['platform-operator', ENV.operatorToken],
      ['internal-actor', ENV.internalActorToken],
      ['actor-superadmin', ENV.actorSuperadminToken],
    ] as const) {
      const response = await call(request, MANAGED_API, token, 'POST', '/v1/functions/actions', `function-bypass-${actor}`, {
        ...functionBody(ENV.tenantA, ENV.workspaceA, 'one'), actionName: `${SAME_NAME}-${actor}`.slice(0, 63),
      })
      await expectDeniedBeforeDependency(response, `Function ${actor} bypass`)
    }

    for (const [operation, method, suffix, data] of [
      ['detail', 'GET', '', undefined],
      ['publish', 'POST', '/versions', { version: 'v2' }],
      ['activate', 'POST', '/versions/v1/approval', undefined],
      ['tool-call', 'POST', '/tool-calls', { name: 'query_items', arguments: {} }],
      ['delete', 'DELETE', '', undefined],
    ] as const) {
      const response = await call(request, MANAGED_API, ENV.sameTenantWrongWorkspaceToken, method, `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}${suffix}`, `wrong-workspace-mcp-${operation}`, data)
      await expectDeniedBeforeDependency(response, `same-tenant wrong-workspace MCP ${operation}`)
    }
    const wrongWorkspaceRpc = await call(request, MANAGED_API, ENV.sameTenantWrongWorkspaceToken, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}/rpc`, 'wrong-workspace-mcp-rpc', {
      jsonrpc: '2.0', id: 93308, method: 'tools/call', params: { name: 'query_items', arguments: {} },
    })
    if (wrongWorkspaceRpc.status() === 200) await expectRpcDeniedBeforeDependency(wrongWorkspaceRpc, 'same-tenant wrong-workspace MCP RPC')
    else await expectDeniedBeforeDependency(wrongWorkspaceRpc, 'same-tenant wrong-workspace MCP RPC')

    const createLabel = 'outage-function-create'
    const create = await call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'POST', '/v1/functions/actions', createLabel, {
      ...functionBody(P8_FUNCTION_ACTOR.tenantId, P8_FUNCTION_ACTOR.workspaceId, 'one'),
      actionName: `${SAME_NAME}-outage`.slice(0, 63).replace(/-+$/, ''),
    })
    expectUnavailable(await expectStatus(create, 503, 'outage Function create'), correlation(createLabel))

    const invokeLabel = 'outage-function-invoke'
    const invoke = await call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'POST', `/v1/functions/actions/${encodeURIComponent(functionA)}/invocations`, invokeLabel, { parameters: {}, responseMode: 'accepted' })
    expectUnavailable(await expectStatus(invoke, 503, 'outage Function invoke'), correlation(invokeLabel))

    const rollbackLabel = 'outage-function-rollback'
    const rollback = await call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'POST', `/v1/functions/actions/${encodeURIComponent(functionA)}/rollback`, rollbackLabel, { versionId: activeVersionBeforeOutage })
    expectUnavailable(await expectStatus(rollback, 503, 'outage Function rollback'), correlation(rollbackLabel))

    const publishLabel = 'outage-mcp-publish'
    const publish = await call(request, MANAGED_API, ENV.mcpOwnerToken, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}/versions`, publishLabel, { version: 'v2' })
    expectUnavailable(await expectStatus(publish, 503, 'outage MCP publish'), correlation(publishLabel))

    const activationLabel = 'outage-mcp-activate'
    const activation = await call(request, MANAGED_API, ENV.mcpOwnerToken, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}/versions/v1/approval`, activationLabel)
    expectUnavailable(await expectStatus(activation, 503, 'outage MCP activate'), correlation(activationLabel))

    const rpcLabel = 'outage-mcp-rpc'
    const rpc = await call(request, MANAGED_API, ENV.mcpConsumerToken, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}/rpc`, rpcLabel, {
      jsonrpc: '2.0', id: 93304, method: 'tools/call', params: { name: 'query_items', arguments: {} },
    })
    const rpcBody = await expectStatus(rpc, 200, 'outage MCP JSON-RPC')
    expect(rpcBody).toEqual({
      jsonrpc: '2.0',
      id: 93304,
      error: {
        code: -32005,
        message: 'Hosted MCP runtime is unavailable.',
        data: {
          code: 'KNATIVE_UNAVAILABLE',
          state: expect.stringMatching(/^(unverified|degraded|unavailable)$/),
          reason: expect.stringMatching(/^[A-Z][A-Z0-9_]{0,63}$/),
          correlationId: correlation(rpcLabel),
        },
      },
    })

    const notificationLabel = 'outage-mcp-notification'
    const notification = await call(request, MANAGED_API, ENV.mcpConsumerToken, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}/rpc`, notificationLabel, {
      jsonrpc: '2.0', method: 'tools/call', params: { name: 'query_items', arguments: {} },
    })
    expect(notification.status()).toBe(202)
    expect(await notification.text()).toBe('')

    const unauthenticated = await request.post(`${MANAGED_API}/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}/rpc`, {
      headers: { 'content-type': 'application/json', 'x-api-version': API_VERSION, 'x-correlation-id': correlation('outage-mcp-unauth') },
      data: { jsonrpc: '2.0', id: 93305, method: 'ping' },
      failOnStatusCode: false,
    })
    expect(unauthenticated.status()).toBe(401)
    expect(JSON.stringify(await jsonBody(unauthenticated))).not.toContain('KNATIVE')

    const foreign = await call(request, MANAGED_API, ENV.tenantBToken, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}/rpc`, 'outage-mcp-foreign', {
      jsonrpc: '2.0', id: 93306, method: 'ping', params: {},
    })
    const foreignBody = await jsonBody(foreign)
    expect([403, 404, 200]).toContain(foreign.status())
    if (foreign.status() === 200) expect((foreignBody.error as JsonObject).code).toBe(-32001)
    expect(JSON.stringify(foreignBody)).not.toContain('KNATIVE')

    const context = await browser.newContext()
    const page = await context.newPage()
    await loginWithCredentials(page, ENV.mcpOwnerUser, ENV.mcpOwnerPassword)
    await page.goto(`${MANAGED_CONSOLE}/console/mcp/servers/${encodeURIComponent(mcpA)}`)
    const workspaceSelect = page.getByTestId('console-context-workspace-select')
    if (await workspaceSelect.isVisible().catch(() => false)) await workspaceSelect.selectOption(ENV.workspaceA)
    await expect(page.getByTestId('mcp-server-detail')).toBeVisible()
    await page.getByRole('tab', { name: 'Área de pruebas' }).click()
    await expect(page.getByRole('button', { name: 'Invocar' })).toBeDisabled()
    await expect(page.getByRole('status')).toContainText(/runtime Hosted MCP no está disponible/i)
    await context.close()
  })

  test('issue-933-09 | P8/P7: outage delete is 202 deletion_pending and replay keeps one correlation', async ({ request }) => {
    const firstFunction = await call(request, MANAGED_API, ENV.tenantBToken, 'DELETE', `/v1/functions/actions/${encodeURIComponent(functionB)}`, 'outage-function-delete-original')
    const firstFunctionBody = await expectStatus(firstFunction, 202, 'outage Function delete')
    expect(firstFunctionBody.status).toBe('deletion_pending')
    functionDeleteCorrelation = String(firstFunctionBody.correlationId)

    const replayFunction = await call(request, MANAGED_API, ENV.tenantBToken, 'DELETE', `/v1/functions/actions/${encodeURIComponent(functionB)}`, 'outage-function-delete-replay')
    const replayFunctionBody = await expectStatus(replayFunction, 202, 'outage Function delete replay')
    expect(replayFunctionBody).toMatchObject({ status: 'deletion_pending', correlationId: functionDeleteCorrelation })

    const functionDetail = await call(request, MANAGED_API, ENV.tenantBToken, 'GET', `/v1/functions/actions/${encodeURIComponent(functionB)}`, 'outage-function-pending-detail')
    const functionDetailBody = await expectStatus(functionDetail, 200, 'pending Function detail')
    expect(functionDetailBody).toMatchObject({
      status: 'deletion_pending',
      runtimeDependency: { mode: 'managed', ready: false },
    })

    const firstMcp = await call(request, MANAGED_API, ENV.tenantBToken, 'DELETE', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceB)}/servers/${encodeURIComponent(mcpB)}`, 'outage-mcp-delete-original')
    const firstMcpBody = await expectStatus(firstMcp, 202, 'outage MCP delete')
    expect(firstMcpBody.status).toBe('deletion_pending')
    mcpDeleteCorrelation = String(firstMcpBody.correlationId)

    const replayMcp = await call(request, MANAGED_API, ENV.tenantBToken, 'DELETE', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceB)}/servers/${encodeURIComponent(mcpB)}`, 'outage-mcp-delete-replay')
    const replayMcpBody = await expectStatus(replayMcp, 202, 'outage MCP delete replay')
    expect(replayMcpBody).toMatchObject({ status: 'deletion_pending', correlationId: mcpDeleteCorrelation })

    const mcpDetail = await call(request, MANAGED_API, ENV.tenantBToken, 'GET', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceB)}/servers/${encodeURIComponent(mcpB)}`, 'outage-mcp-pending-detail')
    const mcpDetailBody = await expectStatus(mcpDetail, 200, 'pending MCP detail')
    expect(mcpDetailBody).toMatchObject({ lifecycleStatus: 'deletion_pending', runtimeDependency: { mode: 'managed', ready: false } })
  })

  test('issue-933-10 | P3: pending cleanup survives control-plane restart and recovers idempotently', async ({ request }) => {
    expect(verifiedTarget, 'live target identity must be verified before restart/recovery').not.toBeNull()
    await runLifecycleCommand('E2E_933_RESTART_COMMAND_JSON', verifiedTarget!)

    const stillPendingFunction = await call(request, MANAGED_API, ENV.tenantBToken, 'GET', `/v1/functions/actions/${encodeURIComponent(functionB)}`, 'restart-function-pending')
    expect((await expectStatus(stillPendingFunction, 200, 'Function pending after restart')).status).toBe('deletion_pending')

    const stillPendingMcp = await call(request, MANAGED_API, ENV.tenantBToken, 'GET', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceB)}/servers/${encodeURIComponent(mcpB)}`, 'restart-mcp-pending')
    expect((await expectStatus(stillPendingMcp, 200, 'MCP pending after restart')).lifecycleStatus).toBe('deletion_pending')

    await runLifecycleCommand('E2E_933_RECOVERY_COMMAND_JSON', verifiedTarget!)
    outageApplied = false
    await expect.poll(async () => (await getRuntime(request, MANAGED_API, ENV.operatorToken, 'recovery-poll')).state, {
      message: 'managed runtime must return to ready',
      timeout: 10 * 60_000,
      intervals: [500, 1_000, 2_000, 5_000, 10_000],
    }).toBe('ready')

    await expect.poll(async () => (await call(request, MANAGED_API, ENV.tenantBToken, 'GET', `/v1/functions/actions/${encodeURIComponent(functionB)}`, 'recovery-function-gone')).status(), {
      message: 'durable Function cleanup must complete after recovery',
      timeout: 5 * 60_000,
      intervals: [1_000, 2_000, 5_000, 10_000],
    }).toBe(404)
    functionB = ''

    await expect.poll(async () => (await call(request, MANAGED_API, ENV.tenantBToken, 'GET', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceB)}/servers/${encodeURIComponent(mcpB)}`, 'recovery-mcp-gone')).status(), {
      message: 'durable MCP cleanup must complete after recovery',
      timeout: 5 * 60_000,
      intervals: [1_000, 2_000, 5_000, 10_000],
    }).toBe(404)

    const invokeA = await call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'POST', `/v1/functions/actions/${encodeURIComponent(functionA)}/invocations`, 'recovery-function-a-still-isolated', {
      parameters: { tenantEcho: 'A-after-recovery' }, responseMode: 'accepted',
    })
    expect(invokeA.status()).toBe(202)

    const pingA = await call(request, MANAGED_API, ENV.mcpConsumerToken, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}/rpc`, 'recovery-mcp-a-still-isolated', {
      jsonrpc: '2.0', id: 93307, method: 'ping', params: {},
    })
    expect(await expectStatus(pingA, 200, 'tenant A MCP after tenant B recovery')).toEqual({ jsonrpc: '2.0', id: 93307, result: {} })

    const mcpRuntimeB = await openshiftFetch(request, 'GET', `/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(ENV.mcpNamespaceB)}/services/${encodeURIComponent(`mcp-${mcpB || 'deleted'}`)}`)
    expect([404, 410]).toContain(mcpRuntimeB.status())
  })

  test('issue-933-10b | P1/P7/P8/P13: ready workspace teardown removes only its owned logical and runtime state', async ({ request }) => {
    const actor: FunctionActorFixture = {
      persona: 'P8', token: ENV.teardownOwnerToken,
      tenantId: ENV.teardownTenant, workspaceId: ENV.teardownReadyWorkspace,
    }
    const functionId = await createFunction(request, actor, 'teardown-ready')
    const serverId = await createMcp(request, ENV.teardownOwnerToken, ENV.teardownReadyWorkspace, 'teardown-ready')
    await expectStatus(await call(request, MANAGED_API, ENV.teardownOwnerToken, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(ENV.teardownReadyWorkspace)}/servers/${encodeURIComponent(serverId)}/versions`, 'teardown-ready-mcp-publish', { version: 'v1' }), 201, 'ready teardown MCP publish')

    const adjacentBefore = await Promise.all([
      call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}`, 'ready-teardown-adjacent-function-before').then((response) => response.text()),
      call(request, MANAGED_API, ENV.mcpOwnerToken, 'GET', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}`, 'ready-teardown-adjacent-mcp-before').then((response) => response.text()),
    ])
    const deleted = await call(request, MANAGED_API, ENV.teardownOwnerToken, 'DELETE', `/v1/workspaces/${encodeURIComponent(ENV.teardownReadyWorkspace)}`, 'teardown-ready-workspace')
    const deletedBody = await expectStatus(deleted, 200, 'ready workspace teardown')
    expect(deletedBody).toMatchObject({ workspaceId: ENV.teardownReadyWorkspace, tenantId: ENV.teardownTenant, deleted: true })
    expect((deletedBody.residual as JsonObject | undefined)?.knativeServices ?? []).toEqual([])
    expect((await call(request, MANAGED_API, ENV.teardownOwnerToken, 'GET', `/v1/functions/actions/${encodeURIComponent(functionId)}`, 'teardown-ready-function-gone')).status()).toBe(404)
    expect((await call(request, MANAGED_API, ENV.teardownOwnerToken, 'GET', `/v1/mcp/workspaces/${encodeURIComponent(ENV.teardownReadyWorkspace)}/servers/${encodeURIComponent(serverId)}`, 'teardown-ready-mcp-gone')).status()).toBe(404)

    const functionSelector = encodeURIComponent(`in-falcone.io/tenant=${ENV.teardownTenant},in-falcone.io/function-resource=${functionId}`)
    const mcpSelector = encodeURIComponent(`in-falcone.io/tenant=${ENV.teardownTenant},in-falcone.io/mcp-server=${serverId}`)
    expect(await listClusterResources(request, `/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(ENV.appNamespace)}/services?labelSelector=${functionSelector}`)).toHaveLength(0)
    expect(await listClusterResources(request, `/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(ENV.teardownNamespace)}/services?labelSelector=${mcpSelector}`)).toHaveLength(0)
    const adjacentAfter = await Promise.all([
      call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}`, 'ready-teardown-adjacent-function-after').then((response) => response.text()),
      call(request, MANAGED_API, ENV.mcpOwnerToken, 'GET', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}`, 'ready-teardown-adjacent-mcp-after').then((response) => response.text()),
    ])
    expect(adjacentAfter).toEqual(adjacentBefore)
  })

  test('issue-933-10c | P1/P3/P7/P8/P13: outage tenant purge retains owner state, then recovery finalizes idempotently', async ({ request }) => {
    expect(verifiedTarget, 'live target identity must be verified before outage teardown').not.toBeNull()
    const actor: FunctionActorFixture = {
      persona: 'P8', token: ENV.teardownOwnerToken,
      tenantId: ENV.teardownTenant, workspaceId: ENV.teardownOutageWorkspace,
    }
    const functionId = await createFunction(request, actor, 'teardown-outage')
    const serverId = await createMcp(request, ENV.teardownOwnerToken, ENV.teardownOutageWorkspace, 'teardown-outage')
    await expectStatus(await call(request, MANAGED_API, ENV.teardownOwnerToken, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(ENV.teardownOutageWorkspace)}/servers/${encodeURIComponent(serverId)}/versions`, 'teardown-outage-mcp-publish', { version: 'v1' }), 201, 'outage teardown MCP publish')
    await expectStatus(await call(request, MANAGED_API, ENV.teardownOwnerToken, 'DELETE', `/v1/tenants/${encodeURIComponent(ENV.teardownTenant)}`, 'teardown-tenant-soft-delete'), 200, 'teardown tenant soft delete')

    await runLifecycleCommand('E2E_933_OUTAGE_COMMAND_JSON', verifiedTarget!)
    outageApplied = true
    await expect.poll(async () => (await getRuntime(request, MANAGED_API, ENV.operatorToken, 'aggregate-outage-poll')).state).not.toBe('ready')
    const adjacentDuringOutage = await Promise.all([
      call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}`, 'aggregate-adjacent-function-outage-before').then((response) => response.text()),
      call(request, MANAGED_API, ENV.mcpOwnerToken, 'GET', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}`, 'aggregate-adjacent-mcp-outage-before').then((response) => response.text()),
    ])

    const pending = await call(request, MANAGED_API, ENV.teardownOwnerToken, 'POST', `/v1/tenants/${encodeURIComponent(ENV.teardownTenant)}/purge`, 'teardown-tenant-purge-pending')
    const pendingBody = await expectStatus(pending, 202, 'outage tenant purge pending')
    expect(pendingBody).toMatchObject({ tenantId: ENV.teardownTenant, status: 'cleanup_pending' })
    expect(pendingBody.obligations).toEqual(expect.any(Array))
    expect((pendingBody.obligations as Json[]).length).toBeGreaterThanOrEqual(2)
    expect(await expectStatus(await call(request, MANAGED_API, ENV.teardownOwnerToken, 'GET', `/v1/functions/actions/${encodeURIComponent(functionId)}`, 'aggregate-pending-function'), 200, 'aggregate pending Function')).toMatchObject({ status: 'deletion_pending' })
    expect(await expectStatus(await call(request, MANAGED_API, ENV.teardownOwnerToken, 'GET', `/v1/mcp/workspaces/${encodeURIComponent(ENV.teardownOutageWorkspace)}/servers/${encodeURIComponent(serverId)}`, 'aggregate-pending-mcp'), 200, 'aggregate pending MCP')).toMatchObject({ lifecycleStatus: 'deletion_pending' })
    const replayPending = await call(request, MANAGED_API, ENV.teardownOwnerToken, 'POST', `/v1/tenants/${encodeURIComponent(ENV.teardownTenant)}/purge`, 'teardown-tenant-purge-pending-replay')
    expect(await expectStatus(replayPending, 202, 'outage tenant purge replay')).toMatchObject({ status: 'cleanup_pending' })
    const adjacentAfterPending = await Promise.all([
      call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}`, 'aggregate-adjacent-function-outage-after').then((response) => response.text()),
      call(request, MANAGED_API, ENV.mcpOwnerToken, 'GET', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}`, 'aggregate-adjacent-mcp-outage-after').then((response) => response.text()),
    ])
    expect(adjacentAfterPending).toEqual(adjacentDuringOutage)

    await runLifecycleCommand('E2E_933_RECOVERY_COMMAND_JSON', verifiedTarget!)
    outageApplied = false
    await expect.poll(async () => (await getRuntime(request, MANAGED_API, ENV.operatorToken, 'aggregate-recovery-poll')).state).toBe('ready')
    const adjacentBeforeFinal = await Promise.all([
      call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}`, 'aggregate-adjacent-function-ready-before').then((response) => response.text()),
      call(request, MANAGED_API, ENV.mcpOwnerToken, 'GET', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}`, 'aggregate-adjacent-mcp-ready-before').then((response) => response.text()),
    ])
    const finalized = await call(request, MANAGED_API, ENV.teardownOwnerToken, 'POST', `/v1/tenants/${encodeURIComponent(ENV.teardownTenant)}/purge`, 'teardown-tenant-purge-final')
    expect(await expectStatus(finalized, 200, 'recovered tenant purge')).toMatchObject({ tenantId: ENV.teardownTenant, purged: true })
    expect((await call(request, MANAGED_API, ENV.teardownOwnerToken, 'GET', `/v1/functions/actions/${encodeURIComponent(functionId)}`, 'aggregate-final-function-gone')).status()).toBe(404)
    expect((await call(request, MANAGED_API, ENV.teardownOwnerToken, 'GET', `/v1/mcp/workspaces/${encodeURIComponent(ENV.teardownOutageWorkspace)}/servers/${encodeURIComponent(serverId)}`, 'aggregate-final-mcp-gone')).status()).toBe(404)
    const terminalReplay = await call(request, MANAGED_API, ENV.teardownOwnerToken, 'POST', `/v1/tenants/${encodeURIComponent(ENV.teardownTenant)}/purge`, 'teardown-tenant-purge-terminal-replay')
    expect(terminalReplay.status()).toBe(404)
    const adjacentAfterFinal = await Promise.all([
      call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}`, 'aggregate-adjacent-function-ready-after').then((response) => response.text()),
      call(request, MANAGED_API, ENV.mcpOwnerToken, 'GET', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}`, 'aggregate-adjacent-mcp-ready-after').then((response) => response.text()),
    ])
    expect(adjacentAfterFinal).toEqual(adjacentBeforeFinal)
  })

  test('issue-933-11 | P10/P3: outage, pending, and recovery share correlation-safe audit/metrics', async ({ request }) => {
    for (const [label, token] of [
      ['copied-operator', ENV.tenantRealmOperatorToken],
      ['copied-auditor', ENV.tenantRealmAuditorToken],
    ] as const) {
      const denied = await call(request, MANAGED_API, token, 'GET', `/v1/metrics/workspaces/${encodeURIComponent(ENV.workspaceB)}/audit-records?page[size]=1`, `metrics-${label}`)
      await expectDeniedBeforeDependency(denied, `tenant-realm ${label} audit`)
    }
    for (const [token, workspaceId, correlationId, label] of [
      [ENV.auditorToken, ENV.workspaceB, functionDeleteCorrelation, 'function-auditor'],
      [ENV.operatorToken, ENV.workspaceB, mcpDeleteCorrelation, 'mcp-operator'],
    ]) {
      const audit = await call(request, MANAGED_API, token, 'GET', `/v1/metrics/workspaces/${encodeURIComponent(workspaceId)}/audit-records?filter[correlationId]=${encodeURIComponent(correlationId)}&page[size]=100`, `audit-${label}`)
      const auditBody = await expectStatus(audit, 200, `${label} correlated audit`)
      const items = auditBody.items as JsonObject[]
      expect(items.length).toBeGreaterThan(0)
      expect(items.every((item) => item.correlationId === correlationId)).toBe(true)
      expect(items.every((item) => (item.scope as JsonObject)?.tenantId === ENV.tenantB && (item.scope as JsonObject)?.workspaceId === ENV.workspaceB)).toBe(true)
      expect(JSON.stringify(auditBody)).not.toMatch(/authorization|bearer|password|secret|status\.json|inlineCode/i)
    }

    const scrapes: string[] = []
    for (const [persona, token, url] of [
      ['P10 platform auditor', ENV.auditorToken, METRICS_URL],
      ['P3 platform operator', ENV.operatorToken, ENV.executorMetricsUrl],
    ] as const) {
      const metrics = await request.get(url, { headers: { authorization: `Bearer ${token}` }, failOnStatusCode: false })
      expect(metrics.status(), `${persona} metrics scrape`).toBe(200)
      const text = await metrics.text()
      scrapes.push(text)
      expect(text).toMatch(/falcone_(?:mcp_)?knative_dependency_events_total/)
      expect(text).not.toMatch(/(?:tenant|workspace|function|server|correlation|actor|resource)_id\s*=/i)
      for (const identifier of [
        ENV.tenantA, ENV.tenantB, ENV.workspaceA, ENV.workspaceB,
        functionA, mcpA, functionDeleteCorrelation, mcpDeleteCorrelation,
        String(jwtPayload(ENV.operatorToken).sub ?? ''), String(jwtPayload(ENV.auditorToken).sub ?? ''),
      ].filter(Boolean)) expect(text, `${persona} scrape leaked ${identifier}`).not.toContain(identifier)
      for (const route of [...text.matchAll(/route="([^"]+)"/g)].map((match) => match[1])) {
        expect(route).not.toMatch(/corr-933|srv-|act_|res_fn_|\/[^/]*(?:tenant|workspace)[^/]*/i)
      }
    }
    const combined = scrapes.join('\n')
    expect(combined).toMatch(/operation="delete"[^\n]*(?:result|outcome)="deferred"/)
    expect(combined).toMatch(/operation="cleanup"[^\n]*(?:result|outcome)="recovered"/)
  })

  test('issue-933-12 | P8/P7/P18: public deletion removes all issue resources, compute, RBAC, and networking', async ({ request }) => {
    expectP8FunctionActorClaims(P8_FUNCTION_ACTOR)
    const functionDelete = await call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'DELETE', `/v1/functions/actions/${encodeURIComponent(functionA)}`, 'cleanup-function-a')
    expect((await expectStatus(functionDelete, 202, 'cleanup Function A')).status).toBe('accepted')

    const mcpDelete = await call(request, MANAGED_API, ENV.mcpOwnerToken, 'DELETE', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}`, 'cleanup-mcp-a')
    expect([200, 204]).toContain(mcpDelete.status())

    await expect.poll(async () => (await call(request, MANAGED_API, P8_FUNCTION_ACTOR.token, 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}`, 'cleanup-function-a-gone')).status(), {
      timeout: 2 * 60_000,
      intervals: [500, 1_000, 2_000, 5_000],
    }).toBe(404)

    await expect.poll(async () => (await call(request, MANAGED_API, ENV.mcpOwnerToken, 'GET', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}`, 'cleanup-mcp-a-gone')).status(), {
      timeout: 2 * 60_000,
      intervals: [500, 1_000, 2_000, 5_000],
    }).toBe(404)

    const remainingFunctionNames = (await listClusterResources(
      request,
      `/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(ENV.appNamespace)}/services?labelSelector=${encodeURIComponent('in-falcone.function=true')}`,
    )).map((item) => String((item.metadata as JsonObject | undefined)?.name ?? '')).filter(Boolean)
    expect(remainingFunctionNames.sort()).toEqual([...baselineFunctionKsvcs].sort())

    const selector = encodeURIComponent(`in-falcone.io/tenant=${ENV.tenantA},in-falcone.io/mcp-server=${mcpA}`)
    for (const resourcePath of [
      `/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(ENV.mcpNamespaceA)}/services?labelSelector=${selector}`,
      `/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(ENV.mcpNamespaceA)}/revisions?labelSelector=${selector}`,
      `/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(ENV.mcpNamespaceA)}/routes?labelSelector=${selector}`,
      `/apis/networking.k8s.io/v1/namespaces/${encodeURIComponent(ENV.mcpNamespaceA)}/networkpolicies?labelSelector=${selector}`,
      `/apis/rbac.authorization.k8s.io/v1/namespaces/${encodeURIComponent(ENV.mcpNamespaceA)}/roles?labelSelector=${selector}`,
      `/apis/rbac.authorization.k8s.io/v1/namespaces/${encodeURIComponent(ENV.mcpNamespaceA)}/rolebindings?labelSelector=${selector}`,
    ]) {
      expect(await listClusterResources(request, resourcePath), `cleanup left resources at ${resourcePath}`).toHaveLength(0)
    }

    functionA = ''
    mcpA = ''
    mcpB = ''
  })
})
