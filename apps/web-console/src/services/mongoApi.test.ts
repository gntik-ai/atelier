import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: vi.fn().mockResolvedValue({})
}))
vi.mock('@/lib/http', () => ({
  requestJson: vi.fn().mockResolvedValue({})
}))

import { requestConsoleSessionJson } from '@/lib/console-session'
import { requestJson } from '@/lib/http'
import {
  buildMongoCurlSnippet,
  buildMongoFrontendSnippet,
  deleteDocument,
  getDocument,
  insertDocument,
  listDocuments,
  previewDocumentsWithApiKey,
  replaceDocument,
  updateDocument
} from './mongoApi'

const mock = requestConsoleSessionJson as unknown as ReturnType<typeof vi.fn>
const rawMock = requestJson as unknown as ReturnType<typeof vi.fn>
const lastCall = () => mock.mock.calls[mock.mock.calls.length - 1]
const base = '/v1/mongo/workspaces/ws1/data/appdb/collections/notes/documents'

beforeEach(() => {
  mock.mockClear()
  mock.mockResolvedValue({})
})

describe('mongoApi — document routes (workspace-scoped, executor)', () => {
  it('listDocuments builds the page[size] query', async () => {
    await listDocuments('ws1', 'appdb', 'notes', { pageSize: 25 })
    expect(lastCall()[0]).toBe(`${base}?page%5Bsize%5D=25`)
  })

  it('listDocuments without options omits the query string', async () => {
    await listDocuments('ws1', 'appdb', 'notes')
    expect(lastCall()).toEqual([base])
  })

  it('listDocuments forwards the cursor, filter, and sort', async () => {
    await listDocuments('ws1', 'appdb', 'notes', {
      pageSize: 10,
      after: 'CURSOR1',
      filter: { status: 'active' },
      sort: { created_at: -1 }
    })
    const sp = new URL(`http://x${lastCall()[0]}`).searchParams
    expect(sp.get('page[size]')).toBe('10')
    expect(sp.get('page[after]')).toBe('CURSOR1')
    expect(JSON.parse(sp.get('filter') as string)).toEqual({ status: 'active' })
    expect(JSON.parse(sp.get('sort') as string)).toEqual({ created_at: -1 })
  })

  it('insertDocument → POST documents { document }', async () => {
    await insertDocument('ws1', 'appdb', 'notes', { body: 'a' })
    expect(lastCall()).toEqual([base, { method: 'POST', body: { document: { body: 'a' } } }])
  })

  it('getDocument → GET documents/{id}', async () => {
    await getDocument('ws1', 'appdb', 'notes', 'd1')
    expect(lastCall()).toEqual([`${base}/d1`])
  })

  it('updateDocument → PATCH documents/{id} { update }', async () => {
    await updateDocument('ws1', 'appdb', 'notes', 'd1', { body: 'b' })
    expect(lastCall()).toEqual([`${base}/d1`, { method: 'PATCH', body: { update: { body: 'b' } } }])
  })

  it('replaceDocument → PUT documents/{id} { document }', async () => {
    await replaceDocument('ws1', 'appdb', 'notes', 'd1', { body: 'c' })
    expect(lastCall()).toEqual([`${base}/d1`, { method: 'PUT', body: { document: { body: 'c' } } }])
  })

  it('deleteDocument → DELETE documents/{id}', async () => {
    await deleteDocument('ws1', 'appdb', 'notes', 'd1')
    expect(lastCall()).toEqual([`${base}/d1`, { method: 'DELETE' }])
  })
})

describe('mongoApi — anon-key embeds', () => {
  const params = { apiKey: 'flc_anon_abc', workspaceId: 'ws1', databaseName: 'appdb', collectionName: 'notes', origin: 'https://api.example.com' }
  const docsUrl = 'https://api.example.com/v1/mongo/workspaces/ws1/data/appdb/collections/notes/documents'

  it('buildMongoFrontendSnippet uses the apikey header (gateway routes by it, not Authorization)', () => {
    const snippet = buildMongoFrontendSnippet(params)
    expect(snippet).toContain("apikey: 'flc_anon_abc'")
    expect(snippet).toContain("'X-API-Version': '2026-03-26'")
    expect(snippet).toContain("'X-Correlation-Id': crypto.randomUUID()")
    expect(snippet).not.toContain('Authorization')
    expect(snippet).toContain(docsUrl)
  })

  it('buildMongoCurlSnippet sends the apikey header', () => {
    const snippet = buildMongoCurlSnippet(params)
    expect(snippet).toContain("-H 'apikey: flc_anon_abc'")
    expect(snippet).toContain("-H 'X-API-Version: 2026-03-26'")
    expect(snippet).toContain("-H 'X-Correlation-Id: corr-client-0001'")
  })

  it('previewDocumentsWithApiKey does a bare apikey request (no console session)', async () => {
    rawMock.mockClear()
    rawMock.mockResolvedValue({ items: [] })
    await previewDocumentsWithApiKey('flc_anon_abc', 'ws1', 'appdb', 'notes', { pageSize: 10 })
    expect(rawMock).toHaveBeenCalledWith(`${base}?page%5Bsize%5D=10`, { headers: { apikey: 'flc_anon_abc' } })
    expect(mock).not.toHaveBeenCalled() // must NOT use the console session (admin JWT)
  })
})
