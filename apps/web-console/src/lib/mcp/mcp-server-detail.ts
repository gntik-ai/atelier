/**
 * MCP server detail view-model + playground request builder (issue #397, epic #386).
 *
 * Pure shaping between the control-plane MCP server payload (registry/versioning, #396; curated
 * tools, #393) and what the console renders: the server endpoint, status, ACTIVE version, source
 * and the curated tool list. Plus `buildPlaygroundToolCall`, which constructs the authenticated
 * JSON-RPC `tools/call` request the playground sends through the gateway using the tenant's OAuth
 * access token (#390) — the network call itself lives in the api/component layer.
 */

export interface McpToolView {
  name: string
  description: string | null
  mutates: boolean
  scope: string | null
}

/** The control-plane payload shape (tolerant of the active-version envelope or a flat server). */
export interface McpServerDetailInput {
  id?: string | null
  name?: string | null
  slug?: string | null
  status?: string | null
  endpoint?: string | null
  endpointUrl?: string | null
  transport?: string | null
  source?: string | null
  version?: string | null
  activeVersion?: {
    version?: string | null
    source?: string | null
    tools?: Array<{ name: string; description?: string | null; mutates?: boolean; scope?: string | null; suggestedScope?: string | null }>
  } | null
  tools?: Array<{ name: string; description?: string | null; mutates?: boolean; scope?: string | null; suggestedScope?: string | null }>
  runtimeDependency?: { state?: string; reason?: string } | null
  runtimeReady?: boolean
}

export interface McpServerDetailView {
  id: string | null
  name: string | null
  slug: string | null
  endpoint: string | null
  status: string | null
  version: string | null
  source: string | null
  transport: string
  tools: McpToolView[]
  runtimeDependency: { state: string; reason: string } | null
  runtimeReady: boolean
}

function toToolView(t: { name: string; description?: string | null; mutates?: boolean; scope?: string | null; suggestedScope?: string | null }): McpToolView {
  return {
    name: t.name,
    description: t.description ?? null,
    mutates: !!t.mutates,
    scope: t.scope ?? t.suggestedScope ?? null
  }
}

/** Shape a control-plane server payload into the detail view-model (endpoint, version, tools). */
export function toMcpServerDetailViewModel(input: McpServerDetailInput = {}): McpServerDetailView {
  const active = input.activeVersion ?? null
  const rawTools = active?.tools ?? input.tools ?? []
  return {
    id: input.id ?? null,
    name: input.name ?? null,
    slug: input.slug ?? null,
    endpoint: input.endpointUrl ?? input.endpoint ?? null,
    status: input.status ?? null,
    version: active?.version ?? input.version ?? null,
    source: active?.source ?? input.source ?? null,
    transport: input.transport ?? 'streamable-http',
    tools: rawTools.map(toToolView),
    runtimeDependency: input.runtimeDependency ? { state: input.runtimeDependency.state ?? 'unknown', reason: input.runtimeDependency.reason ?? '' } : null,
    runtimeReady: input.runtimeReady !== false
  }
}

export interface PlaygroundToolCall {
  url: string
  method: 'POST'
  headers: Record<string, string>
  body: {
    jsonrpc: '2.0'
    id: number
    method: 'tools/call'
    params: { name: string; arguments: Record<string, unknown> }
  }
}

export interface BuildPlaygroundToolCallInput {
  endpoint: string | null
  toolName: string
  args?: Record<string, unknown>
  accessToken: string | null
  protocolVersion?: string
  id?: number
}

/**
 * Build the authenticated MCP `tools/call` request for the playground.
 * Requires the OAuth access token — the playground only calls through the tenant's OAuth flow.
 * @throws if the endpoint or the OAuth access token is missing
 */
export function buildPlaygroundToolCall({
  endpoint,
  toolName,
  args = {},
  accessToken,
  protocolVersion = '2025-11-25',
  id = 1
}: BuildPlaygroundToolCallInput): PlaygroundToolCall {
  if (!endpoint) throw new Error('MCP endpoint is not available for this server yet.')
  if (!accessToken) throw new Error('An OAuth access token is required to call a tool from the playground.')
  if (!toolName) throw new Error('A tool name is required.')
  return {
    url: endpoint,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${accessToken}`,
      'MCP-Protocol-Version': protocolVersion
    },
    body: {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: toolName, arguments: args }
    }
  }
}
