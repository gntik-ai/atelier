import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { realtimeChangesUrl, subscribeRealtimeChanges } from './realtimeApi'

const streamResponse = (...chunks: string[]) => {
  const read = vi.fn()
  for (const chunk of chunks) read.mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(chunk) })
  read.mockResolvedValueOnce({ done: true })
  return { ok: true, body: { getReader: () => ({ read }) } }
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

describe('realtimeApi', () => {
  it('builds the Mongo SSE URL with the anon key as ?apikey=', () => {
    const url = realtimeChangesUrl({ workspaceId: 'ws1', target: { source: 'mongo', databaseName: 'appdb', collectionName: 'notes' }, apiKey: 'flc_anon_x', origin: 'https://api.example.com' })
    expect(url).toBe('https://api.example.com/v1/realtime/workspaces/ws1/data/appdb/collections/notes/changes?apikey=flc_anon_x')
  })

  it('builds the Postgres SSE URL (schemas/tables)', () => {
    const url = realtimeChangesUrl({ workspaceId: 'ws1', target: { source: 'postgres', databaseName: 'appdb', schemaName: 'public', tableName: 'notes' }, apiKey: 'flc_anon_x', origin: 'https://api.example.com' })
    expect(url).toBe('https://api.example.com/v1/realtime/workspaces/ws1/data/appdb/schemas/public/tables/notes/changes?apikey=flc_anon_x')
  })

  it('subscribes over header-capable fetch SSE and dispatches named JSON events', async () => {
    vi.mocked(fetch).mockResolvedValue(streamResponse(
      'event: insert\ndata: {"type":"insert","documentId":"d1","document":{"_id":"d1"}}\n\n',
      'event: update\ndata: {"type":"update","documentId":"d1","document":{"_id":"d1"}}\n\n'
    ) as unknown as Response)
    const changes: unknown[] = []
    const sub = subscribeRealtimeChanges({
      workspaceId: 'ws1', target: { source: 'mongo', databaseName: 'appdb', collectionName: 'notes' }, apiKey: 'flc_anon_x',
      onChange: (c) => changes.push(c)
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('apikey=flc_anon_x'), expect.any(Object))
    const headers = new Headers(vi.mocked(fetch).mock.calls[0]?.[1]?.headers)
    expect(headers.get('x-api-version')).toBe('2026-03-26')
    expect(headers.get('x-correlation-id')).toMatch(/^[A-Za-z0-9._:-]{8,128}$/)
    expect(changes).toHaveLength(2)
    sub.close()
  })

  it('ignores malformed JSON and reports transport errors', async () => {
    const onChange = vi.fn(); const onError = vi.fn()
    vi.mocked(fetch).mockResolvedValue(streamResponse('event: insert\ndata: {bad\n\nevent: update\ndata: {"type":"update"}\n\n') as unknown as Response)
    const sub = subscribeRealtimeChanges({ workspaceId: 'ws1', target: { source: 'mongo', databaseName: 'appdb', collectionName: 'notes' }, apiKey: 'k', onChange, onError })
    await new Promise((resolve) => setTimeout(resolve, 0)); expect(onChange).toHaveBeenCalledTimes(1); sub.close()
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    subscribeRealtimeChanges({ workspaceId: 'ws1', target: { source: 'mongo', databaseName: 'appdb', collectionName: 'notes' }, apiKey: 'k', onChange, onError })
    await new Promise((resolve) => setTimeout(resolve, 0)); expect(onError).toHaveBeenCalled()
  })
})
