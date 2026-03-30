import test from 'node:test'
import assert from 'node:assert/strict'
import { assembleWorkspaceDocs } from '../src/doc-assembler.mjs'

test('assembleWorkspaceDocs builds enabled services', async () => {
  const db = { query: async () => ({ rows: [] }) }
  const internalClient = {
    getApiSurface: async () => ({ baseUrl: 'https://api.example.test', tokenEndpoint: 'https://iam.example.test/token' }),
    getEffectiveCapabilities: async () => ({ capabilities: [{ key: 'postgres-database', endpoint: 'pg.example.test', port: 5432, name: 'app_db' }, { key: 'storage-bucket', endpoint: 'https://s3.example.test', name: 'bucket-a', region: 'eu-west-1' }] })
  }

  const result = await assembleWorkspaceDocs({ tenantId: 'ten-1', workspaceId: 'wrk-1' }, db, internalClient)
  assert.equal(result.baseUrl, 'https://api.example.test')
  assert.equal(result.enabledServices.length, 2)
})

test('assembleWorkspaceDocs returns stale payload on upstream 503', async () => {
  const db = { query: async () => ({ rows: [] }) }
  const internalClient = {
    getApiSurface: async () => { const error = new Error('fail'); error.statusCode = 503; throw error },
    getEffectiveCapabilities: async () => ({ capabilities: [] })
  }

  const result = await assembleWorkspaceDocs({ tenantId: 'ten-1', workspaceId: 'wrk-1' }, db, internalClient)
  assert.equal(result.stale, true)
})
