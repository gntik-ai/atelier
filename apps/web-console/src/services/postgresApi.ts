// PostgreSQL data + schema + API-key client for the console (change: add-console-postgres-data-editor).
// Centralizes the calls to the control-plane executor (Phases 0-2): DDL execution, row CRUD,
// and workspace API keys. URLs match the executor's HTTP routes exactly.
import { requestConsoleSessionJson } from '@/lib/console-session'
import { requestJson, type JsonValue } from '@/lib/http'

const enc = encodeURIComponent

export interface PgColumnInput {
  columnName: string
  dataType: string
  nullable?: boolean
  constraints?: { primaryKey?: boolean; unique?: boolean; checkExpression?: string }
  defaultExpression?: string
}

export interface DdlResult {
  executed: boolean
  executionMode: 'execute' | 'preview'
  statements: string[]
  statementCount?: number
}

export type PgRow = Record<string, JsonValue>

export type PgFilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'like' | 'ilike'

export interface PgFilter {
  columnName: string
  operator: PgFilterOperator
  value: string | number | boolean | Array<string | number>
}

export interface RowListResult {
  items: PgRow[]
  page?: { size?: number; returned?: number; after?: string }
  count?: number
}

export interface ApiKeyRecord {
  id: string
  key_type: 'anon' | 'service'
  key_prefix: string
  scopes: string[]
  status: 'active' | 'revoked'
  created_at: string
  last_used_at?: string | null
}

export interface IssuedApiKey {
  id: string
  key: string // plaintext — shown ONCE
  prefix: string
  keyType: 'anon' | 'service'
  scopes: string[]
}

// ---- Schema / DDL (database-scoped) ----
const ddlBase = (db: string, schema: string) =>
  `/v1/postgres/databases/${enc(db)}/schemas/${enc(schema)}`

export function createSchema(databaseName: string, schemaName: string): Promise<DdlResult> {
  return requestConsoleSessionJson<DdlResult>(`/v1/postgres/databases/${enc(databaseName)}/schemas`, {
    method: 'POST',
    body: { schemaName }
  })
}

export function createTable(
  databaseName: string,
  schemaName: string,
  tableName: string,
  columns: PgColumnInput[],
  options: { preview?: boolean } = {}
): Promise<DdlResult> {
  const suffix = options.preview ? '?mode=preview' : ''
  return requestConsoleSessionJson<DdlResult>(`${ddlBase(databaseName, schemaName)}/tables${suffix}`, {
    method: 'POST',
    body: { tableName, columns } as unknown as JsonValue
  })
}

export function addColumn(
  databaseName: string,
  schemaName: string,
  tableName: string,
  column: PgColumnInput
): Promise<DdlResult> {
  return requestConsoleSessionJson<DdlResult>(`${ddlBase(databaseName, schemaName)}/tables/${enc(tableName)}/columns`, {
    method: 'POST',
    body: { ...column } as unknown as JsonValue
  })
}

export function createIndex(
  databaseName: string,
  schemaName: string,
  tableName: string,
  index: { indexName: string; keys: { columnName: string }[]; indexMethod?: string; unique?: boolean }
): Promise<DdlResult> {
  return requestConsoleSessionJson<DdlResult>(`${ddlBase(databaseName, schemaName)}/tables/${enc(tableName)}/indexes`, {
    method: 'POST',
    body: { indexMethod: 'btree', ...index } as unknown as JsonValue
  })
}

// ---- Data rows (workspace-scoped) ----
const dataBase = (workspaceId: string, db: string, schema: string, table: string) =>
  `/v1/postgres/workspaces/${enc(workspaceId)}/data/${enc(db)}/schemas/${enc(schema)}/tables/${enc(table)}`

function pkQuery(primaryKey: Record<string, string | number>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(primaryKey)) params.set(k, String(v))
  return params.toString()
}

function filterToQueryValue(filter: PgFilter): string {
  if (filter.operator === 'in' && Array.isArray(filter.value)) {
    return `in.(${filter.value.join(',')})`
  }
  return `${filter.operator}.${String(filter.value)}`
}

export function listRows(
  workspaceId: string,
  databaseName: string,
  schemaName: string,
  tableName: string,
  options: {
    pageSize?: number
    after?: string
    countMode?: 'none' | 'exact'
    select?: string[]
    order?: Array<{ columnName: string; direction?: 'asc' | 'desc' }>
    filters?: PgFilter[]
  } = {}
): Promise<RowListResult> {
  const params = new URLSearchParams()
  if (options.pageSize != null) params.set('page[size]', String(options.pageSize))
  if (options.after != null) params.set('page[after]', options.after)
  if (options.countMode) params.set('countMode', options.countMode)
  if (options.select && options.select.length > 0) params.set('select', options.select.join(','))
  if (options.order && options.order.length > 0) {
    params.set('order', options.order.map((entry) => `${entry.columnName}:${entry.direction ?? 'asc'}`).join(','))
  }
  // PostgREST-style filters: one query param per filter (duplicates allowed).
  for (const filter of options.filters ?? []) params.append(filter.columnName, filterToQueryValue(filter))
  const qs = params.toString()
  return requestConsoleSessionJson<RowListResult>(`${dataBase(workspaceId, databaseName, schemaName, tableName)}/rows${qs ? `?${qs}` : ''}`)
}

export function insertRow(
  workspaceId: string,
  databaseName: string,
  schemaName: string,
  tableName: string,
  values: PgRow
): Promise<{ item: PgRow }> {
  return requestConsoleSessionJson<{ item: PgRow }>(`${dataBase(workspaceId, databaseName, schemaName, tableName)}/rows`, {
    method: 'POST',
    body: { values }
  })
}

export function updateRow(
  workspaceId: string,
  databaseName: string,
  schemaName: string,
  tableName: string,
  primaryKey: Record<string, string | number>,
  changes: PgRow
): Promise<{ item: PgRow; affected: number }> {
  return requestConsoleSessionJson<{ item: PgRow; affected: number }>(
    `${dataBase(workspaceId, databaseName, schemaName, tableName)}/rows/by-primary-key?${pkQuery(primaryKey)}`,
    { method: 'PATCH', body: { changes } }
  )
}

export function deleteRow(
  workspaceId: string,
  databaseName: string,
  schemaName: string,
  tableName: string,
  primaryKey: Record<string, string | number>
): Promise<{ affected: number }> {
  return requestConsoleSessionJson<{ affected: number }>(
    `${dataBase(workspaceId, databaseName, schemaName, tableName)}/rows/by-primary-key?${pkQuery(primaryKey)}`,
    { method: 'DELETE' }
  )
}

export function bulkInsert(
  workspaceId: string,
  databaseName: string,
  schemaName: string,
  tableName: string,
  rows: PgRow[]
): Promise<{ items: PgRow[]; affected: number }> {
  return requestConsoleSessionJson<{ items: PgRow[]; affected: number }>(
    `${dataBase(workspaceId, databaseName, schemaName, tableName)}/rows/bulk/insert`,
    { method: 'POST', body: { rows } }
  )
}

// ---- Table data export / import (change: add-data-export-import-clone, #683) ----
export interface PgDataExport {
  entityType: string
  databaseName: string
  schemaName: string
  tableName: string
  columns: string[]
  rowCount: number
  rows: PgRow[]
}

export interface PgDataImportResult {
  entityType: string
  databaseName: string
  schemaName: string
  tableName: string
  totalEntries: number
  importedCount: number
  skippedCount: number
}

// Export a table's rows (bounded, inline). The backend validates every identifier against
// information_schema and quotes it; values are bound — never string-interpolated.
export function exportTableRows(
  workspaceId: string,
  databaseName: string,
  schemaName: string,
  tableName: string,
  options: { limit?: number } = {}
): Promise<PgDataExport> {
  const body: Record<string, number> = {}
  if (options.limit != null) body.limit = options.limit
  return requestConsoleSessionJson<PgDataExport>(
    `${dataBase(workspaceId, databaseName, schemaName, tableName)}/exports`,
    { method: 'POST', body }
  )
}

// Import rows into a table. Only keys that are real, validated columns of the target table are
// inserted (unknown keys are dropped server-side).
export function importTableRows(
  workspaceId: string,
  databaseName: string,
  schemaName: string,
  tableName: string,
  rows: PgRow[]
): Promise<PgDataImportResult> {
  return requestConsoleSessionJson<PgDataImportResult>(
    `${dataBase(workspaceId, databaseName, schemaName, tableName)}/imports`,
    { method: 'POST', body: { rows } }
  )
}

// ---- Workspace API keys ----
const keysBase = (workspaceId: string) => `/v1/workspaces/${enc(workspaceId)}/api-keys`

export function issueApiKey(workspaceId: string, keyType: 'anon' | 'service'): Promise<IssuedApiKey> {
  return requestConsoleSessionJson<IssuedApiKey>(keysBase(workspaceId), { method: 'POST', body: { keyType } })
}

export function listApiKeys(workspaceId: string): Promise<{ items: ApiKeyRecord[] }> {
  return requestConsoleSessionJson<{ items: ApiKeyRecord[] }>(keysBase(workspaceId))
}

export function revokeApiKey(workspaceId: string, id: string): Promise<{ id: string; revoked: boolean }> {
  return requestConsoleSessionJson<{ id: string; revoked: boolean }>(`${keysBase(workspaceId)}/${enc(id)}`, {
    method: 'DELETE'
  })
}

export function rotateApiKey(workspaceId: string, id: string): Promise<IssuedApiKey> {
  return requestConsoleSessionJson<IssuedApiKey>(`${keysBase(workspaceId)}/${enc(id)}/rotations`, { method: 'POST' })
}

export interface EmbedSnippetParams {
  apiKey: string
  workspaceId: string
  databaseName: string
  schemaName: string
  tableName: string
  origin?: string
}

function embedRowsUrl(params: EmbedSnippetParams): string {
  return `${params.origin ?? 'https://<your-falcone-host>'}/v1/postgres/workspaces/${params.workspaceId}/data/${params.databaseName}/schemas/${params.schemaName}/tables/${params.tableName}/rows`
}

// A copy-paste fetch() snippet a developer pastes into their frontend. NOTE: the gateway
// routes anon/service keys by the `apikey` header (not Authorization), so the snippet must
// send `apikey` for the request to reach the data executor.
export function buildFrontendSnippet(params: EmbedSnippetParams): string {
  return [
    `const res = await fetch(`,
    `  '${embedRowsUrl(params)}',`,
    `  { headers: { apikey: '${params.apiKey}', 'X-API-Version': '2026-03-26', 'X-Correlation-Id': crypto.randomUUID() } }`,
    `)`,
    `const { items } = await res.json()`
  ].join('\n')
}

// A copy-paste curl snippet (same apikey-header contract).
export function buildCurlSnippet(params: EmbedSnippetParams): string {
  return [
    `curl -H 'apikey: ${params.apiKey}' -H 'X-API-Version: 2026-03-26' \\`,
    `  -H 'X-Correlation-Id: corr-client-0001' '${embedRowsUrl(params)}'`
  ].join('\n')
}

// Run a live, read-only preview AS the anon/service key: a bare request carrying only the
// `apikey` header (no console session JWT) — exactly what a frontend app does. Proves the
// key works end-to-end through the gateway and shows the RLS-scoped rows.
export function previewRowsWithApiKey(
  apiKey: string,
  workspaceId: string,
  databaseName: string,
  schemaName: string,
  tableName: string,
  options: { pageSize?: number } = {}
): Promise<RowListResult> {
  const params = new URLSearchParams()
  if (options.pageSize != null) params.set('page[size]', String(options.pageSize))
  const qs = params.toString()
  return requestJson<RowListResult>(
    `${dataBase(workspaceId, databaseName, schemaName, tableName)}/rows${qs ? `?${qs}` : ''}`,
    { headers: { apikey: apiKey } }
  )
}
