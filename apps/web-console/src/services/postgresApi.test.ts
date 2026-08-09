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
  addColumn,
  buildCurlSnippet,
  buildFrontendSnippet,
  createIndex,
  createSchema,
  createTable,
  deleteRow,
  insertRow,
  issueApiKey,
  listApiKeys,
  listRows,
  previewRowsWithApiKey,
  revokeApiKey,
  rotateApiKey,
  updateRow
} from './postgresApi'

const mock = requestConsoleSessionJson as unknown as ReturnType<typeof vi.fn>
const rawMock = requestJson as unknown as ReturnType<typeof vi.fn>
const lastCall = () => mock.mock.calls[mock.mock.calls.length - 1]

beforeEach(() => {
  mock.mockClear()
  mock.mockResolvedValue({})
})

describe('postgresApi — DDL routes (database-scoped)', () => {
  it('createSchema → POST databases/{db}/schemas', async () => {
    await createSchema('appdb', 'app1')
    expect(lastCall()).toEqual(['/v1/postgres/databases/appdb/schemas', { method: 'POST', body: { schemaName: 'app1' } }])
  })

  it('createTable → POST .../schemas/{s}/tables with columns', async () => {
    await createTable('appdb', 'app1', 'items', [{ columnName: 'id', dataType: 'uuid' }])
    expect(lastCall()[0]).toBe('/v1/postgres/databases/appdb/schemas/app1/tables')
    expect(lastCall()[1]).toMatchObject({ method: 'POST', body: { tableName: 'items', columns: [{ columnName: 'id', dataType: 'uuid' }] } })
  })

  it('createTable preview adds ?mode=preview', async () => {
    await createTable('appdb', 'app1', 'items', [{ columnName: 'id', dataType: 'uuid' }], { preview: true })
    expect(lastCall()[0]).toBe('/v1/postgres/databases/appdb/schemas/app1/tables?mode=preview')
  })

  it('addColumn → POST .../tables/{t}/columns', async () => {
    await addColumn('appdb', 'app1', 'items', { columnName: 'price', dataType: 'integer' })
    expect(lastCall()[0]).toBe('/v1/postgres/databases/appdb/schemas/app1/tables/items/columns')
    expect(lastCall()[1].body).toMatchObject({ columnName: 'price', dataType: 'integer' })
  })

  it('createIndex → POST .../tables/{t}/indexes with default btree', async () => {
    await createIndex('appdb', 'app1', 'items', { indexName: 'items_name_idx', keys: [{ columnName: 'name' }] })
    expect(lastCall()[0]).toBe('/v1/postgres/databases/appdb/schemas/app1/tables/items/indexes')
    expect(lastCall()[1].body).toMatchObject({ indexMethod: 'btree', indexName: 'items_name_idx', keys: [{ columnName: 'name' }] })
  })
})

describe('postgresApi — data routes (workspace-scoped)', () => {
  const dataPath = '/v1/postgres/workspaces/ws1/data/appdb/schemas/app1/tables/items'

  it('listRows builds page[size] + countMode query', async () => {
    await listRows('ws1', 'appdb', 'app1', 'items', { pageSize: 50, countMode: 'exact' })
    expect(lastCall()[0]).toBe(`${dataPath}/rows?page%5Bsize%5D=50&countMode=exact`)
  })

  it('listRows without options omits the query string', async () => {
    await listRows('ws1', 'appdb', 'app1', 'items')
    expect(lastCall()[0]).toBe(`${dataPath}/rows`)
  })

  it('listRows forwards the keyset cursor (page[after])', async () => {
    await listRows('ws1', 'appdb', 'app1', 'items', { pageSize: 2, after: 'CURSOR123' })
    expect(lastCall()[0]).toBe(`${dataPath}/rows?page%5Bsize%5D=2&page%5Bafter%5D=CURSOR123`)
  })

  it('listRows encodes select + order', async () => {
    await listRows('ws1', 'appdb', 'app1', 'items', { select: ['id', 'name'], order: [{ columnName: 'name', direction: 'desc' }] })
    expect(lastCall()[0]).toBe(`${dataPath}/rows?select=id%2Cname&order=name%3Adesc`)
  })

  it('listRows encodes PostgREST-style filters (incl. in.(...))', async () => {
    await listRows('ws1', 'appdb', 'app1', 'items', {
      filters: [
        { columnName: 'status', operator: 'eq', value: 'active' },
        { columnName: 'age', operator: 'gte', value: 18 },
        { columnName: 'id', operator: 'in', value: [1, 2, 3] }
      ]
    })
    expect(lastCall()[0]).toBe(`${dataPath}/rows?status=eq.active&age=gte.18&id=in.%281%2C2%2C3%29`)
  })

  it('insertRow → POST rows { values }', async () => {
    await insertRow('ws1', 'appdb', 'app1', 'items', { name: 'a' })
    expect(lastCall()).toEqual([`${dataPath}/rows`, { method: 'POST', body: { values: { name: 'a' } } }])
  })

  it('updateRow → PATCH rows/by-primary-key?id=.. { changes }', async () => {
    await updateRow('ws1', 'appdb', 'app1', 'items', { id: 'r1' }, { name: 'b' })
    expect(lastCall()).toEqual([`${dataPath}/rows/by-primary-key?id=r1`, { method: 'PATCH', body: { changes: { name: 'b' } } }])
  })

  it('deleteRow → DELETE rows/by-primary-key?id=..', async () => {
    await deleteRow('ws1', 'appdb', 'app1', 'items', { id: 'r1' })
    expect(lastCall()).toEqual([`${dataPath}/rows/by-primary-key?id=r1`, { method: 'DELETE' }])
  })
})

describe('postgresApi — workspace API keys', () => {
  it('issueApiKey → POST api-keys { keyType }', async () => {
    await issueApiKey('ws1', 'anon')
    expect(lastCall()).toEqual(['/v1/workspaces/ws1/api-keys', { method: 'POST', body: { keyType: 'anon' } }])
  })
  it('listApiKeys → GET api-keys', async () => {
    await listApiKeys('ws1')
    expect(lastCall()).toEqual(['/v1/workspaces/ws1/api-keys'])
  })
  it('revokeApiKey → DELETE api-keys/{id}', async () => {
    await revokeApiKey('ws1', 'k1')
    expect(lastCall()).toEqual(['/v1/workspaces/ws1/api-keys/k1', { method: 'DELETE' }])
  })
  it('rotateApiKey → POST api-keys/{id}/rotations', async () => {
    await rotateApiKey('ws1', 'k1')
    expect(lastCall()).toEqual(['/v1/workspaces/ws1/api-keys/k1/rotations', { method: 'POST' }])
  })
})

describe('anon-key embeds', () => {
  const params = {
    apiKey: 'flc_anon_abc', workspaceId: 'ws1', databaseName: 'appdb', schemaName: 'app1', tableName: 'items', origin: 'https://api.example.com'
  }
  const rowsUrl = 'https://api.example.com/v1/postgres/workspaces/ws1/data/appdb/schemas/app1/tables/items/rows'

  it('buildFrontendSnippet uses the apikey header (the gateway routes by it, not Authorization)', () => {
    const snippet = buildFrontendSnippet(params)
    expect(snippet).toContain("apikey: 'flc_anon_abc'")
    expect(snippet).toContain("'X-API-Version': '2026-03-26'")
    expect(snippet).toContain("'X-Correlation-Id': crypto.randomUUID()")
    expect(snippet).not.toContain('Authorization')
    expect(snippet).toContain(rowsUrl)
  })

  it('buildCurlSnippet sends the apikey header', () => {
    const snippet = buildCurlSnippet(params)
    expect(snippet).toContain("-H 'apikey: flc_anon_abc'")
    expect(snippet).toContain("-H 'X-API-Version: 2026-03-26'")
    expect(snippet).toContain("-H 'X-Correlation-Id: corr-client-0001'")
    expect(snippet).toContain(rowsUrl)
  })

  it('previewRowsWithApiKey does a bare apikey request (no console session) to the rows route', async () => {
    rawMock.mockClear()
    rawMock.mockResolvedValue({ items: [] })
    await previewRowsWithApiKey('flc_anon_abc', 'ws1', 'appdb', 'app1', 'items', { pageSize: 10 })
    expect(rawMock).toHaveBeenCalledWith(
      '/v1/postgres/workspaces/ws1/data/appdb/schemas/app1/tables/items/rows?page%5Bsize%5D=10',
      { headers: { apikey: 'flc_anon_abc' } }
    )
    // it must NOT go through the console session (which would attach the admin JWT)
    expect(mock).not.toHaveBeenCalled()
  })
})
