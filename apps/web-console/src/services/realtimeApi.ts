// Realtime change-stream client for the console (changes: add-realtime-gateway-console,
// add-realtime-unify). Subscribes to a tenant-scoped change stream via Server-Sent Events,
// for EITHER a Mongo collection or a Postgres table. The anon key remains in the endpoint URL
// for the executor's existing authentication contract; subscribeSse supplies trace headers.
import type { JsonValue } from '@/lib/http'
import { subscribeSse } from '@/lib/sse'

const enc = encodeURIComponent

export interface RealtimeChange {
  type: string
  documentId: JsonValue
  document: Record<string, JsonValue> | null
}

export interface RealtimeSubscription {
  close: () => void
}

export type RealtimeTarget =
  | { source: 'mongo'; databaseName: string; collectionName: string }
  | { source: 'postgres'; databaseName: string; schemaName: string; tableName: string }

// Postgres can also emit deletes (the Mongo change stream does not).
const CHANGE_EVENTS = ['insert', 'update', 'replace', 'delete']

export function realtimeChangesUrl(params: { workspaceId: string; target: RealtimeTarget; apiKey: string; origin?: string }): string {
  const t = params.target
  const wp = `${params.origin ?? ''}/v1/realtime/workspaces/${enc(params.workspaceId)}/data/${enc(t.databaseName)}`
  const path = t.source === 'mongo'
    ? `${wp}/collections/${enc(t.collectionName)}/changes`
    : `${wp}/schemas/${enc(t.schemaName)}/tables/${enc(t.tableName)}/changes`
  return `${path}?apikey=${enc(params.apiKey)}`
}

export function subscribeRealtimeChanges(params: {
  workspaceId: string
  target: RealtimeTarget
  apiKey: string
  onChange: (change: RealtimeChange) => void
  onError?: (event: Event) => void
  origin?: string
}): RealtimeSubscription {
  const handlers = Object.fromEntries(CHANGE_EVENTS.map((type) => [type, (data: string) => {
    try { params.onChange(JSON.parse(data) as RealtimeChange) } catch { /* ignore malformed frame */ }
  }]))
  return subscribeSse(realtimeChangesUrl(params), handlers, params.onError)
}
