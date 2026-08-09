// MongoDB document data client for the console (change: add-console-mongo-data-editor).
// Calls the control-plane executor's Mongo document routes exactly. URLs match the executor.
import { requestConsoleSessionJson } from '@/lib/console-session'
import { requestJson, type JsonValue } from '@/lib/http'

const enc = encodeURIComponent

export type MongoDocument = Record<string, JsonValue>
export type MongoFilter = Record<string, JsonValue>
export type MongoSort = Record<string, 1 | -1 | 'asc' | 'desc'>

export interface DocumentListResult {
  items: MongoDocument[]
  page?: { size?: number; returned?: number; after?: string }
}

const docsBase = (workspaceId: string, db: string, collection: string) =>
  `/v1/mongo/workspaces/${enc(workspaceId)}/data/${enc(db)}/collections/${enc(collection)}/documents`

export function listDocuments(
  workspaceId: string,
  databaseName: string,
  collectionName: string,
  options: { pageSize?: number; after?: string; filter?: MongoFilter; sort?: MongoSort } = {}
): Promise<DocumentListResult> {
  const params = new URLSearchParams()
  if (options.pageSize != null) params.set('page[size]', String(options.pageSize))
  if (options.after != null) params.set('page[after]', options.after)
  if (options.filter && Object.keys(options.filter).length > 0) params.set('filter', JSON.stringify(options.filter))
  if (options.sort && Object.keys(options.sort).length > 0) params.set('sort', JSON.stringify(options.sort))
  const qs = params.toString()
  return requestConsoleSessionJson<DocumentListResult>(
    `${docsBase(workspaceId, databaseName, collectionName)}${qs ? `?${qs}` : ''}`
  )
}

export function insertDocument(
  workspaceId: string,
  databaseName: string,
  collectionName: string,
  document: MongoDocument
): Promise<{ item: MongoDocument }> {
  return requestConsoleSessionJson<{ item: MongoDocument }>(
    docsBase(workspaceId, databaseName, collectionName),
    { method: 'POST', body: { document } }
  )
}

export function getDocument(
  workspaceId: string,
  databaseName: string,
  collectionName: string,
  documentId: string
): Promise<{ item: MongoDocument }> {
  return requestConsoleSessionJson<{ item: MongoDocument }>(
    `${docsBase(workspaceId, databaseName, collectionName)}/${enc(documentId)}`
  )
}

export function updateDocument(
  workspaceId: string,
  databaseName: string,
  collectionName: string,
  documentId: string,
  update: MongoDocument
): Promise<{ item: MongoDocument }> {
  return requestConsoleSessionJson<{ item: MongoDocument }>(
    `${docsBase(workspaceId, databaseName, collectionName)}/${enc(documentId)}`,
    { method: 'PATCH', body: { update } }
  )
}

export function replaceDocument(
  workspaceId: string,
  databaseName: string,
  collectionName: string,
  documentId: string,
  document: MongoDocument
): Promise<{ item: MongoDocument }> {
  return requestConsoleSessionJson<{ item: MongoDocument }>(
    `${docsBase(workspaceId, databaseName, collectionName)}/${enc(documentId)}`,
    { method: 'PUT', body: { document } }
  )
}

export function deleteDocument(
  workspaceId: string,
  databaseName: string,
  collectionName: string,
  documentId: string
): Promise<{ deleted: boolean }> {
  return requestConsoleSessionJson<{ deleted: boolean }>(
    `${docsBase(workspaceId, databaseName, collectionName)}/${enc(documentId)}`,
    { method: 'DELETE' }
  )
}

// ---- Document export / import (change: add-data-export-import-clone, #683) ----
const dataBase = (workspaceId: string, db: string, collection: string) =>
  `/v1/mongo/workspaces/${enc(workspaceId)}/data/${enc(db)}/collections/${enc(collection)}`

export interface MongoDataExport {
  entityType: string
  sourceWorkspaceId: string
  sourceTenantId: string
  databaseName: string
  collectionName: string
  documentCount: number
  documents: MongoDocument[]
}

export interface MongoDataImportResult {
  entityType: string
  targetWorkspaceId: string
  targetTenantId: string
  totalEntries: number
  importedCount: number
  skippedCount: number
}

// Export the caller-workspace documents of a collection (bounded, inline). The backend reads only
// documents stamped with this workspace's tenant+workspace scope.
export function exportDocuments(
  workspaceId: string,
  databaseName: string,
  collectionName: string,
  options: { limit?: number } = {}
): Promise<MongoDataExport> {
  const body: Record<string, JsonValue> = {}
  if (options.limit != null) body.limit = options.limit
  return requestConsoleSessionJson<MongoDataExport>(
    `${dataBase(workspaceId, databaseName, collectionName)}/exports`,
    { method: 'POST', body }
  )
}

// Import documents into a collection. The backend re-stamps the caller's verified tenant+workspace
// onto every document (any body-supplied scope is ignored).
export function importDocuments(
  workspaceId: string,
  databaseName: string,
  collectionName: string,
  documents: MongoDocument[]
): Promise<MongoDataImportResult> {
  return requestConsoleSessionJson<MongoDataImportResult>(
    `${dataBase(workspaceId, databaseName, collectionName)}/imports`,
    { method: 'POST', body: { documents } }
  )
}

// ---- Anon-key embeds (Supabase-style) ----
export interface MongoEmbedParams {
  apiKey: string
  workspaceId: string
  databaseName: string
  collectionName: string
  origin?: string
}

function embedDocsUrl(params: MongoEmbedParams): string {
  return `${params.origin ?? 'https://<your-falcone-host>'}/v1/mongo/workspaces/${params.workspaceId}/data/${params.databaseName}/collections/${params.collectionName}/documents`
}

// fetch() snippet a developer pastes into their frontend. The gateway routes anon/service
// keys by the `apikey` HEADER (not Authorization), so the snippet must send `apikey`.
export function buildMongoFrontendSnippet(params: MongoEmbedParams): string {
  return [
    `const res = await fetch(`,
    `  '${embedDocsUrl(params)}',`,
    `  { headers: { apikey: '${params.apiKey}', 'X-API-Version': '2026-03-26', 'X-Correlation-Id': crypto.randomUUID() } }`,
    `)`,
    `const { items } = await res.json()`
  ].join('\n')
}

export function buildMongoCurlSnippet(params: MongoEmbedParams): string {
  return [
    `curl -H 'apikey: ${params.apiKey}' -H 'X-API-Version: 2026-03-26' \\`,
    `  -H 'X-Correlation-Id: corr-client-0001' '${embedDocsUrl(params)}'`
  ].join('\n')
}

// Live read-only preview AS the anon key: a bare request carrying only the `apikey` header
// (no console session JWT) — exactly what a frontend app does.
export function previewDocumentsWithApiKey(
  apiKey: string,
  workspaceId: string,
  databaseName: string,
  collectionName: string,
  options: { pageSize?: number } = {}
): Promise<DocumentListResult> {
  const params = new URLSearchParams()
  if (options.pageSize != null) params.set('page[size]', String(options.pageSize))
  const qs = params.toString()
  return requestJson<DocumentListResult>(
    `${docsBase(workspaceId, databaseName, collectionName)}${qs ? `?${qs}` : ''}`,
    { headers: { apikey: apiKey } }
  )
}
