// Flow execution-monitoring API client for the console (change: add-console-flow-monitoring / #366).
//
// Two layers, mirroring how realtimeApi.ts and flowsApi.ts split:
//   1. SSE subscription — `flowExecutionEventsUrl` + `subscribeFlowExecution` use the shared
//      fetch/ReadableStream adapter. The (low-privilege, read-only) anon key remains as ?apikey=;
//      the gateway routes it to the executor, which verifies the key and enforces tenant isolation.
//      The hook reconnects with Last-Event-ID; `stream-end` signals the run is terminal → close().
//   2. REST control — list/detail executions + cancel/retry/signal actions over the #361 flow API,
//      threaded through requestConsoleSessionJson (bearer token + refresh) like flowsApi.ts.
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { JsonValue } from '@/lib/http'
import { subscribeSse } from '@/lib/sse'

const enc = encodeURIComponent

// ---- SSE frame payloads (must match the executor's emitted shape) --------------------------

export type NodeStatus =
  | 'scheduled'
  | 'started'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'waiting-approval'

export interface NodeStatusEvent {
  type: 'node-status'
  id?: string
  nodeId: string
  status: NodeStatus
  attemptNumber?: number
  startedAt?: string | null
  completedAt?: string | null
  error?: { message: string; stack?: string } | null
}

export interface LogLineEvent {
  type: 'log-line'
  id?: string
  nodeId: string
  level: string
  message: string
  timestamp?: string | null
}

export interface StreamEndEvent {
  type: 'stream-end'
  status?: string
}

export type FlowExecutionEvent = NodeStatusEvent | LogLineEvent | StreamEndEvent

export interface FlowExecutionSubscription {
  close: () => void
}

// The named SSE events the executor emits (server.mjs::runFlowMonitoringSse).
const EXECUTION_EVENTS = ['node-status', 'log-line', 'stream-end'] as const

// Build the SSE endpoint URL with the anon key as ?apikey=. The URL matches the executor's SSE
// route exactly: GET .../executions/{executionId}/events.
export function flowExecutionEventsUrl(params: {
  workspaceId: string
  executionId: string
  apiKey: string
  origin?: string
}): string {
  const base = `${params.origin ?? ''}/v1/flows/workspaces/${enc(params.workspaceId)}/executions/${enc(params.executionId)}/events`
  return `${base}?apikey=${enc(params.apiKey)}`
}

// Subscribe to a single execution's SSE stream. Registers a listener per named event and forwards
// the parsed frame to onEvent. `stream-end` is forwarded too so the caller can close on terminal.
// Returns { close } so the hook can abort the fetch stream on unmount. Mirrors realtimeApi.ts.
export function subscribeFlowExecution(params: {
  workspaceId: string
  executionId: string
  apiKey: string
  onEvent: (event: FlowExecutionEvent) => void
  onError?: (event: Event) => void
  origin?: string
}): FlowExecutionSubscription {
  const handlers = Object.fromEntries(EXECUTION_EVENTS.map((type) => [type, (data: string) => {
    try { params.onEvent(JSON.parse(data) as FlowExecutionEvent) } catch { /* ignore malformed frame */ }
  }]))
  return subscribeSse(flowExecutionEventsUrl(params), handlers, params.onError)
}

// ---- REST control: execution list / detail / actions (#361) --------------------------------

export type ExecutionStatus = string // Temporal status name (Running / Completed / Failed / …)

export interface ExecutionSummary {
  executionId: string
  workflowId: string
  runId?: string | null
  status?: ExecutionStatus | null
  startedAt?: string | null
  closedAt?: string | null
  version?: string | number | null
  triggerType?: string | null
  flowId?: string | null
}

export interface ExecutionListResponse {
  items: ExecutionSummary[]
  nextPageToken?: string | null
}

export interface ExecutionAttempt {
  status: NodeStatus
  attemptNumber?: number
  startedAt?: string | null
  completedAt?: string | null
}

export interface ExecutionNodeDetail {
  nodeId: string
  status?: NodeStatus | null
  input?: JsonValue | null
  output?: JsonValue | null
  error?: { message: string; stack?: string } | null
  attempts?: ExecutionAttempt[]
}

export interface ExecutionDetail {
  executionId: string
  workflowId: string
  status?: ExecutionStatus | null
  version?: string | number | null
  startedAt?: string | null
  closedAt?: string | null
  input?: JsonValue | null
  result?: JsonValue | null
  events?: Array<{ nodeId: string; eventId?: string; type?: string }>
  nodes?: ExecutionNodeDetail[]
}

const flowsBase = (workspaceId: string) => `/v1/flows/workspaces/${enc(workspaceId)}/flows`

// Terminal Temporal statuses — drive the disable-cancel / show-retry UI gating.
const TERMINAL = new Set(['Completed', 'Failed', 'Canceled', 'Cancelled', 'Terminated', 'TimedOut', 'ContinuedAsNew'])
export function isTerminalExecution(status: string | null | undefined): boolean {
  return status != null && TERMINAL.has(status)
}

export interface ExecutionListFilters {
  flowId: string
  flowVersion?: string
  status?: string
  triggerType?: string
  startedAfter?: string
  startedBefore?: string
  pageToken?: string
}

// Build the Temporal visibility `query` clause from the UI filters. The server ALWAYS AND-joins
// its own non-overridable tenantId/workspaceId boundary (flow-executor.ts::sanitizeClientQuery),
// so these client predicates can only narrow, never broaden, the tenant scope.
function buildVisibilityQuery(filters: ExecutionListFilters): string | undefined {
  const terms: string[] = []
  if (filters.flowVersion) terms.push(`flowVersion = '${filters.flowVersion}'`)
  if (filters.triggerType) terms.push(`triggerType = '${filters.triggerType}'`)
  if (filters.startedAfter) terms.push(`StartTime >= '${filters.startedAfter}'`)
  if (filters.startedBefore) terms.push(`StartTime <= '${filters.startedBefore}'`)
  return terms.length > 0 ? terms.join(' AND ') : undefined
}

export function listExecutions(
  workspaceId: string,
  filters: ExecutionListFilters
): Promise<ExecutionListResponse> {
  const search = new URLSearchParams()
  if (filters.status) search.set('status', filters.status)
  const query = buildVisibilityQuery(filters)
  if (query) search.set('query', query)
  if (filters.pageToken) search.set('page[after]', filters.pageToken)
  const qs = search.toString()
  return requestConsoleSessionJson<ExecutionListResponse>(
    `${flowsBase(workspaceId)}/${enc(filters.flowId)}/executions${qs ? `?${qs}` : ''}`
  )
}

export function getExecution(
  workspaceId: string,
  flowId: string,
  executionId: string
): Promise<ExecutionDetail> {
  return requestConsoleSessionJson<ExecutionDetail>(
    `${flowsBase(workspaceId)}/${enc(flowId)}/executions/${enc(executionId)}`
  )
}

export function cancelExecution(
  workspaceId: string,
  flowId: string,
  executionId: string
): Promise<{ executionId: string; status: string }> {
  return requestConsoleSessionJson(
    `${flowsBase(workspaceId)}/${enc(flowId)}/executions/${enc(executionId)}/cancellations`,
    { method: 'POST' }
  )
}

export function retryExecution(
  workspaceId: string,
  flowId: string,
  executionId: string
): Promise<{ executionId: string; status: string; version?: number }> {
  return requestConsoleSessionJson(
    `${flowsBase(workspaceId)}/${enc(flowId)}/executions/${enc(executionId)}/retries`,
    { method: 'POST' }
  )
}

// Send an approval/rejection signal to a waiting human-approval node. `signalName` is the approval
// node id (or the `human-approval` alias); the payload carries the approving actor + decision.
export function sendApprovalSignal(
  workspaceId: string,
  flowId: string,
  executionId: string,
  signalName: string,
  decision: { approved: boolean; nodeId?: string }
): Promise<{ executionId: string; signal: string; delivered: boolean }> {
  return requestConsoleSessionJson(
    `${flowsBase(workspaceId)}/${enc(flowId)}/executions/${enc(executionId)}/signals/${enc(signalName)}`,
    { method: 'POST', body: { approved: decision.approved, nodeId: decision.nodeId } as unknown as JsonValue }
  )
}
