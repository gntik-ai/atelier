/**
 * issue-933-managed-knative-runtime | add-managed-knative-serving
 *
 * Personas: P18 installer, P3 platform operator, P8 Function developer, P7 MCP owner,
 * P12 MCP consumer, P10 read-only auditor, and P13 adjacent-tenant adversary.
 * Capabilities: fn-managed-knative-runtime-status, fn-managed-knative-functions,
 * fn-managed-knative-hosted-mcp, fn-managed-knative-outage-recovery,
 * fn-managed-knative-tenant-isolation, and fn-managed-knative-observability.
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
 * `remote-openshift-4.21-cluster-admin`. The spec then proves the live server is OpenShift 4.21,
 * Kubernetes 1.34, and the supplied credential can create cluster-scoped Knative prerequisites.
 * It also requires chart issue #8's coordinated release/status declaration and verifies the
 * chart-fed Falcone status API reports managed/compatible/ready. Environment claims alone are
 * therefore insufficient to pass.
 *
 * Lifecycle command variables are JSON argv arrays, for example:
 *   E2E_933_OUTAGE_COMMAND_JSON='["falcone-knative","acceptance","outage",...]'
 * They are executed without a shell. They must target only the disposable acceptance cluster.
 * The companion chart owns their implementation; this repository only consumes the public CLI.
 *
 * A local kind run may opt into the separately labelled contract/regression subset with
 * E2E_933_LOCAL_REGRESSION=1. That subset never satisfies or claims OpenShift acceptance.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test'

const execFileAsync = promisify(execFile)
const API_VERSION = '2026-03-26'
const ACCEPTANCE_PROFILE = 'remote-openshift-4.21-cluster-admin'
const MANAGED_API = process.env.E2E_933_API_BASE_URL ?? process.env.E2E_API_BASE_URL ?? process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const MANAGED_CONSOLE = process.env.E2E_933_CONSOLE_BASE_URL ?? process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const EXTERNAL_API = process.env.E2E_933_EXTERNAL_API_BASE_URL ?? ''
const DISABLED_API = process.env.E2E_933_DISABLED_API_BASE_URL ?? ''
const OPENSHIFT_API = process.env.E2E_933_OPENSHIFT_API_URL ?? ''
const METRICS_URL = process.env.E2E_933_METRICS_URL ?? ''
const RUN_ID = (process.env.E2E_933_RUN_ID ?? 'issue933').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'issue933'
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
  openshiftToken: process.env.E2E_933_OPENSHIFT_TOKEN ?? '',
  tenantA: process.env.E2E_933_TENANT_A ?? '',
  workspaceA: process.env.E2E_933_WORKSPACE_A ?? '',
  tenantB: process.env.E2E_933_TENANT_B ?? '',
  workspaceB: process.env.E2E_933_WORKSPACE_B ?? '',
  operatorUser: process.env.E2E_933_OPERATOR_USER ?? '',
  operatorPassword: process.env.E2E_933_OPERATOR_PASSWORD ?? '',
  auditorUser: process.env.E2E_933_AUDITOR_USER ?? '',
  auditorPassword: process.env.E2E_933_AUDITOR_PASSWORD ?? '',
  appNamespace: process.env.E2E_933_APP_NAMESPACE ?? '',
  mcpNamespaceA: process.env.E2E_933_MCP_NAMESPACE_A ?? '',
  mcpNamespaceB: process.env.E2E_933_MCP_NAMESPACE_B ?? '',
}

const REMOTE_ACCEPTANCE_ENV = [
  'E2E_933_API_BASE_URL',
  'E2E_933_CONSOLE_BASE_URL',
  'E2E_933_EXTERNAL_API_BASE_URL',
  'E2E_933_DISABLED_API_BASE_URL',
  'E2E_933_OPENSHIFT_API_URL',
  'E2E_933_OPENSHIFT_TOKEN',
  'E2E_933_CHART_ISSUE8_RELEASE',
  'E2E_933_CHART_ISSUE8_STATUS',
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
  'E2E_933_TENANT_A',
  'E2E_933_WORKSPACE_A',
  'E2E_933_TENANT_B',
  'E2E_933_WORKSPACE_B',
  'E2E_933_OPERATOR_USER',
  'E2E_933_OPERATOR_PASSWORD',
  'E2E_933_AUDITOR_USER',
  'E2E_933_AUDITOR_PASSWORD',
  'E2E_933_APP_NAMESPACE',
  'E2E_933_MCP_NAMESPACE_A',
  'E2E_933_MCP_NAMESPACE_B',
  'E2E_933_METRICS_URL',
  'E2E_933_OUTAGE_COMMAND_JSON',
  'E2E_933_RESTART_COMMAND_JSON',
  'E2E_933_RECOVERY_COMMAND_JSON',
] as const

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type JsonObject = { [key: string]: Json }
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

function missingAcceptancePrerequisites(): string[] {
  const missing = REMOTE_ACCEPTANCE_ENV.filter((name) => !(process.env[name] ?? '').trim())
  if (process.env.E2E_933_ACCEPTANCE_PROFILE !== ACCEPTANCE_PROFILE) {
    missing.unshift(`E2E_933_ACCEPTANCE_PROFILE=${ACCEPTANCE_PROFILE}`)
  }
  if (process.env.E2E_933_CHART_ISSUE8_STATUS !== 'compatible') {
    missing.push('E2E_933_CHART_ISSUE8_STATUS=compatible')
  }
  return [...new Set(missing)]
}

const missingAcceptance = missingAcceptancePrerequisites()
const acceptanceSkipReason = [
  'OpenShift acceptance is fail-closed: companion gntik-ai/falcone-charts#8 must publish a compatible coordinated release,',
  'and a disposable REMOTE OpenShift 4.21 cluster-admin target must be supplied. kind/CRC/local OpenShift are not substitutes.',
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

function parseCommand(name: 'E2E_933_OUTAGE_COMMAND_JSON' | 'E2E_933_RESTART_COMMAND_JSON' | 'E2E_933_RECOVERY_COMMAND_JSON'): CommandSpec {
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
  return { file, args }
}

async function runLifecycleCommand(name: 'E2E_933_OUTAGE_COMMAND_JSON' | 'E2E_933_RESTART_COMMAND_JSON' | 'E2E_933_RECOVERY_COMMAND_JSON'): Promise<void> {
  const { file, args } = parseCommand(name)
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
  token: string,
  tenantId: string,
  workspaceId: string,
  suffix: string,
): Promise<string> {
  const response = await call(request, MANAGED_API, token, 'POST', '/v1/functions/actions', `function-create-${suffix}`, functionBody(tenantId, workspaceId, 'one'))
  expect([201, 202], `Function create ${suffix}: ${await response.text()}`).toContain(response.status())
  const body = await jsonBody<JsonObject>(response)
  expect(body.resourceId).toEqual(expect.any(String))
  return String(body.resourceId)
}

async function createMcp(request: APIRequestContext, token: string, workspaceId: string, suffix: string): Promise<string> {
  const response = await call(request, MANAGED_API, token, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(workspaceId)}/servers`, `mcp-create-${suffix}`, {
    name: SAME_NAME,
    source: 'instant',
    generator: 'postgres',
  })
  const body = await expectStatus(response, 201, `MCP create ${suffix}`)
  expect(body.serverId).toEqual(expect.any(String))
  return String(body.serverId)
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
  let rollbackVersionA = ''
  let activeVersionBeforeOutage = ''
  let functionDeleteCorrelation = ''
  let mcpDeleteCorrelation = ''
  let outageApplied = false
  let baselineFunctionKsvcs: string[] = []

  test.afterAll(async ({ request }) => {
    // Recovery and public-API deletion are best-effort fallback cleanup for an assertion failure.
    // The successful path proves cleanup explicitly in the final scenario.
    if (outageApplied) await runLifecycleCommand('E2E_933_RECOVERY_COMMAND_JSON').catch(() => undefined)
    if (functionA) await deleteBestEffort(request, ENV.functionDeveloperToken, `/v1/functions/actions/${encodeURIComponent(functionA)}`, 'fallback-function-a')
    if (functionB) await deleteBestEffort(request, ENV.tenantBToken, `/v1/functions/actions/${encodeURIComponent(functionB)}`, 'fallback-function-b')
    if (mcpA) await deleteBestEffort(request, ENV.mcpOwnerToken, `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}`, 'fallback-mcp-a')
    if (mcpB) await deleteBestEffort(request, ENV.tenantBToken, `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceB)}/servers/${encodeURIComponent(mcpB)}`, 'fallback-mcp-b')
  })

  test('issue-933-01 | P18/P3: remote OpenShift 4.21 cluster-admin and chart #8 compatible managed status are real', async ({ request }) => {
    expect(process.env.E2E_933_CHART_ISSUE8_STATUS).toBe('compatible')
    expect(process.env.E2E_933_CHART_ISSUE8_RELEASE).toMatch(/\S/)

    const versionResponse = await openshiftFetch(request, 'GET', '/version')
    const version = await expectStatus(versionResponse, 200, 'OpenShift Kubernetes version')
    expect(version.gitVersion).toMatch(/^v1\.34(?:\.|$)/)

    const clusterVersionResponse = await openshiftFetch(request, 'GET', '/apis/config.openshift.io/v1/clusterversions/version')
    const clusterVersion = await expectStatus(clusterVersionResponse, 200, 'OpenShift ClusterVersion')
    const desiredVersion = (clusterVersion.status as JsonObject | undefined)?.desiredVersion as JsonObject | undefined
    expect(desiredVersion?.version).toMatch(/^4\.21(?:\.|$)/)

    await canCreateClusterResource(request, 'apiextensions.k8s.io', 'customresourcedefinitions')
    await canCreateClusterResource(request, 'rbac.authorization.k8s.io', 'clusterroles')
    await canCreateClusterResource(request, 'admissionregistration.k8s.io', 'validatingwebhookconfigurations')

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

    const denied = await call(request, MANAGED_API, ENV.functionDeveloperToken, 'GET', '/v1/platform/runtime/knative', 'status-tenant-denied')
    expect(denied.status()).toBe(403)
    expect(JSON.stringify(await jsonBody(denied))).not.toMatch(/owner|version|READY|degraded|unavailable/i)

    const unauthenticated = await request.get(`${MANAGED_API}/v1/platform/runtime/knative`, {
      headers: { 'x-api-version': API_VERSION, 'x-correlation-id': correlation('status-unauthenticated') },
      failOnStatusCode: false,
    })
    expect(unauthenticated.status()).toBe(401)

    for (const persona of [
      { role: 'platform_operator', username: ENV.operatorUser, password: ENV.operatorPassword },
      { role: 'platform_auditor', username: ENV.auditorUser, password: ENV.auditorPassword },
    ]) {
      const context = await browser.newContext()
      const page = await context.newPage()
      await loginAs(page, persona.username, persona.password, persona.role)
      await page.goto(`${MANAGED_CONSOLE}/console/runtime`)
      await expect(page.getByRole('heading', { name: 'Runtime de funciones' })).toBeVisible()
      await expect(page.getByText('Plataforma · solo lectura')).toBeVisible()
      await expect(page.getByText('Gestionado por la plataforma')).toBeVisible()
      await expect(page.getByLabel('Estado del runtime: Listo')).toBeVisible()
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
    functionA = await createFunction(request, ENV.functionDeveloperToken, ENV.tenantA, ENV.workspaceA, 'tenant-a')
    functionB = await createFunction(request, ENV.tenantBToken, ENV.tenantB, ENV.workspaceB, 'tenant-b')
    expect(functionA).not.toBe(functionB)

    for (const [token, resourceId, tenantEcho, label] of [
      [ENV.functionDeveloperToken, functionA, 'A', 'a'],
      [ENV.tenantBToken, functionB, 'B', 'b'],
    ]) {
      const invoke = await call(request, MANAGED_API, token, 'POST', `/v1/functions/actions/${encodeURIComponent(resourceId)}/invocations`, `function-invoke-${label}`, {
        parameters: { tenantEcho },
        triggerContext: { kind: 'direct', correlationKey: correlation(`function-invoke-${label}`) },
        responseMode: 'wait_for_result',
        idempotencyScope: 'request',
      })
      const body = await expectStatus(invoke, 202, `Function invoke ${label}`)
      expect(['accepted', 'queued', 'running', 'completed']).toContain(body.status)
    }

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
    const update = await call(request, MANAGED_API, ENV.functionDeveloperToken, 'PATCH', `/v1/functions/actions/${encodeURIComponent(functionA)}`, 'function-update-a', functionBody(ENV.tenantA, ENV.workspaceA, 'two'))
    expect([200, 202], `Function update: ${await update.text()}`).toContain(update.status())

    const versionsResponse = await call(request, MANAGED_API, ENV.functionDeveloperToken, 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}/versions`, 'function-versions-a')
    const versionsBody = await expectStatus(versionsResponse, 200, 'Function versions')
    const versions = versionsBody.items as JsonObject[]
    expect(versions).toHaveLength(2)
    const rollbackTarget = versions.find((item) => item.rollbackEligible === true)
    const active = versions.find((item) => item.status === 'active')
    expect(rollbackTarget?.versionId).toEqual(expect.any(String))
    expect(active?.versionId).toEqual(expect.any(String))
    rollbackVersionA = String(rollbackTarget?.versionId)
    activeVersionBeforeOutage = String(active?.versionId)

    const rollback = await call(request, MANAGED_API, ENV.functionDeveloperToken, 'POST', `/v1/functions/actions/${encodeURIComponent(functionA)}/rollback`, 'function-rollback-a', {
      versionId: rollbackVersionA,
      reason: 'Issue #933 managed-runtime acceptance rollback',
    })
    const rollbackBody = await expectStatus(rollback, 202, 'Function rollback')
    expect(rollbackBody.requestedVersionId).toBe(rollbackVersionA)

    const detail = await call(request, MANAGED_API, ENV.functionDeveloperToken, 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}`, 'function-detail-after-rollback')
    const detailBody = await expectStatus(detail, 200, 'Function detail after rollback')
    expect(detailBody.activeVersionId).toBe(rollbackVersionA)
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
    expect(((listBody.result as JsonObject).tools as JsonObject[]).length).toBeGreaterThan(0)

    const foreign = await call(request, MANAGED_API, ENV.tenantBToken, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}/rpc`, 'mcp-foreign-ready', {
      jsonrpc: '2.0', id: 93302, method: 'ping', params: {},
    })
    expect([403, 404, 200]).toContain(foreign.status())
    const foreignBody = await jsonBody(foreign)
    if (foreign.status() === 200) expect((foreignBody.error as JsonObject).code).toBe(-32001)
    expect(JSON.stringify(foreignBody)).not.toMatch(/KNATIVE|READY|degraded|unavailable|tenant-a/i)

    for (const [namespace, serverId] of [[ENV.mcpNamespaceA, mcpA], [ENV.mcpNamespaceB, mcpB]]) {
      const ksvc = await openshiftFetch(request, 'GET', `/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(namespace)}/services/${encodeURIComponent(`mcp-${serverId}`)}`)
      expect(ksvc.status(), `hosted MCP ${serverId} must own a real Knative Service`).toBe(200)
    }
  })

  test('issue-933-07 | P3/P12: hosted MCP scales to zero and a public JSON-RPC call cold-starts it', async ({ request }) => {
    const podsPath = `/api/v1/namespaces/${encodeURIComponent(ENV.mcpNamespaceA)}/pods?labelSelector=${encodeURIComponent(`serving.knative.dev/service=mcp-${mcpA}`)}`
    await expect.poll(async () => (await listClusterResources(request, podsPath)).length, {
      message: 'hosted MCP should scale to zero without a fixed sleep',
      timeout: Number(process.env.E2E_933_SCALE_TO_ZERO_TIMEOUT_MS ?? 10 * 60_000),
      intervals: [1_000, 2_000, 5_000, 10_000],
    }).toBe(0)

    const ping = await call(request, MANAGED_API, ENV.mcpConsumerToken, 'POST', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}/rpc`, 'mcp-cold-start', {
      jsonrpc: '2.0', id: 93303, method: 'ping', params: {},
    })
    const pingBody = await expectStatus(ping, 200, 'MCP cold-start ping')
    expect(pingBody).toEqual({ jsonrpc: '2.0', id: 93303, result: {} })
  })

  test('issue-933-08 | P3/P8/P7/P12/P13: outage contracts are exact and tenant-safe', async ({ request }) => {
    await runLifecycleCommand('E2E_933_OUTAGE_COMMAND_JSON')
    outageApplied = true

    await expect.poll(async () => (await getRuntime(request, MANAGED_API, ENV.operatorToken, 'outage-poll')).state, {
      message: 'chart status must close the Falcone workload gate',
      timeout: 5 * 60_000,
      intervals: [500, 1_000, 2_000, 5_000],
    }).not.toBe('ready')

    const createLabel = 'outage-function-create'
    const create = await call(request, MANAGED_API, ENV.functionDeveloperToken, 'POST', '/v1/functions/actions', createLabel, {
      ...functionBody(ENV.tenantA, ENV.workspaceA, 'one'),
      actionName: `${SAME_NAME}-outage`.slice(0, 63).replace(/-+$/, ''),
    })
    expectUnavailable(await expectStatus(create, 503, 'outage Function create'), correlation(createLabel))

    const invokeLabel = 'outage-function-invoke'
    const invoke = await call(request, MANAGED_API, ENV.functionDeveloperToken, 'POST', `/v1/functions/actions/${encodeURIComponent(functionA)}/invocations`, invokeLabel, { parameters: {}, responseMode: 'accepted' })
    expectUnavailable(await expectStatus(invoke, 503, 'outage Function invoke'), correlation(invokeLabel))

    const rollbackLabel = 'outage-function-rollback'
    const rollback = await call(request, MANAGED_API, ENV.functionDeveloperToken, 'POST', `/v1/functions/actions/${encodeURIComponent(functionA)}/rollback`, rollbackLabel, { versionId: activeVersionBeforeOutage })
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
    await runLifecycleCommand('E2E_933_RESTART_COMMAND_JSON')

    const stillPendingFunction = await call(request, MANAGED_API, ENV.tenantBToken, 'GET', `/v1/functions/actions/${encodeURIComponent(functionB)}`, 'restart-function-pending')
    expect((await expectStatus(stillPendingFunction, 200, 'Function pending after restart')).status).toBe('deletion_pending')

    const stillPendingMcp = await call(request, MANAGED_API, ENV.tenantBToken, 'GET', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceB)}/servers/${encodeURIComponent(mcpB)}`, 'restart-mcp-pending')
    expect((await expectStatus(stillPendingMcp, 200, 'MCP pending after restart')).lifecycleStatus).toBe('deletion_pending')

    await runLifecycleCommand('E2E_933_RECOVERY_COMMAND_JSON')
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

    const invokeA = await call(request, MANAGED_API, ENV.functionDeveloperToken, 'POST', `/v1/functions/actions/${encodeURIComponent(functionA)}/invocations`, 'recovery-function-a-still-isolated', {
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

  test('issue-933-11 | P10/P3: outage, pending, and recovery share correlation-safe audit/metrics', async ({ request }) => {
    for (const [token, workspaceId, correlationId, label] of [
      [ENV.tenantBToken, ENV.workspaceB, functionDeleteCorrelation, 'function'],
      [ENV.tenantBToken, ENV.workspaceB, mcpDeleteCorrelation, 'mcp'],
    ]) {
      const audit = await call(request, MANAGED_API, token, 'GET', `/v1/metrics/workspaces/${encodeURIComponent(workspaceId)}/audit-records?filter[correlationId]=${encodeURIComponent(correlationId)}&page[size]=100`, `audit-${label}`)
      const auditBody = await expectStatus(audit, 200, `${label} correlated audit`)
      expect(JSON.stringify(auditBody)).toContain(correlationId)
      expect(JSON.stringify(auditBody)).not.toMatch(/authorization|bearer|password|secret|status\.json|inlineCode/i)
    }

    const metrics = await request.get(METRICS_URL, { failOnStatusCode: false })
    expect(metrics.status()).toBe(200)
    const text = await metrics.text()
    expect(text).toContain('falcone_knative_dependency_events_total')
    expect(text).toMatch(/capability="function"[^\n]*operation="delete"[^\n]*result="deferred"/)
    expect(text).toMatch(/capability="mcp"[^\n]*operation="delete"[^\n]*result="deferred"/)
    expect(text).toMatch(/operation="cleanup"[^\n]*result="recovered"/)
    expect(text).not.toContain(ENV.tenantA)
    expect(text).not.toContain(ENV.tenantB)
    expect(text).not.toContain(ENV.workspaceA)
    expect(text).not.toContain(ENV.workspaceB)
    expect(text).not.toContain(functionA)
    expect(text).not.toContain(mcpA)
  })

  test('issue-933-12 | P8/P7/P18: public deletion removes all issue resources, compute, RBAC, and networking', async ({ request }) => {
    const functionDelete = await call(request, MANAGED_API, ENV.functionDeveloperToken, 'DELETE', `/v1/functions/actions/${encodeURIComponent(functionA)}`, 'cleanup-function-a')
    expect((await expectStatus(functionDelete, 202, 'cleanup Function A')).status).toBe('accepted')

    const mcpDelete = await call(request, MANAGED_API, ENV.mcpOwnerToken, 'DELETE', `/v1/mcp/workspaces/${encodeURIComponent(ENV.workspaceA)}/servers/${encodeURIComponent(mcpA)}`, 'cleanup-mcp-a')
    expect([200, 204]).toContain(mcpDelete.status())

    await expect.poll(async () => (await call(request, MANAGED_API, ENV.functionDeveloperToken, 'GET', `/v1/functions/actions/${encodeURIComponent(functionA)}`, 'cleanup-function-a-gone')).status(), {
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
