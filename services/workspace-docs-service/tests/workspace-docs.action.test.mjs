import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv2020 from 'ajv/dist/2020.js'
import schema from '../../internal-contracts/src/workspace-docs-response.json' with { type: 'json' }
import noteSchema from '../../internal-contracts/src/workspace-doc-note.json' with { type: 'json' }
import { main } from '../actions/workspace-docs.mjs'

const ajv = new Ajv2020({ strict: false })
ajv.addSchema(noteSchema, 'workspace-doc-note.json')
const validate = ajv.compile(schema)

test('GET docs returns payload matching schema', async () => {
  const db = { query: async () => ({ rows: [], rowCount: 1 }) }
  const result = await main({
    method: 'GET',
    path: '/v1/workspaces/wrk-1/docs',
    headers: { 'X-API-Version': '2026-03-01', 'X-Correlation-Id': 'corr-1' },
    auth: { tenantId: 'ten-1', workspaceId: 'wrk-1', actorId: 'actor-1', roles: ['workspace_viewer'] },
    db,
    kafkaProducer: { send: async () => {} },
    internalClient: {
      getApiSurface: async () => ({ baseUrl: 'https://api.example.test', tokenEndpoint: 'https://iam.example.test/token' }),
      getEffectiveCapabilities: async () => ({ capabilities: [{ key: 'postgres-database', endpoint: 'pg.example.test', port: 5432, name: 'app_db' }, { key: 'storage-bucket', endpoint: 'https://s3.example.test', name: 'bucket-a', region: 'eu-west-1' }] })
    }
  })

  assert.equal(result.statusCode, 200)
  assert.equal(validate(result.body), true)
})

test('GET docs returns 400 on unsupported version', async () => {
  const result = await main({ method: 'GET', path: '/v1/workspaces/wrk-1/docs', headers: { 'X-API-Version': '2026-03-99' }, auth: { tenantId: 'ten-1', workspaceId: 'wrk-1', actorId: 'actor-1', roles: ['workspace_viewer'] }, db: { query: async () => ({ rows: [] }) } })
  assert.equal(result.statusCode, 400)
})

test('GET docs returns stale 200 body when assembler degrades upstream', async () => {
  const db = { query: async () => ({ rows: [], rowCount: 1 }) }
  const result = await main({
    method: 'GET',
    path: '/v1/workspaces/wrk-1/docs',
    headers: { 'X-API-Version': '2026-03-01', 'X-Correlation-Id': 'corr-1' },
    auth: { tenantId: 'ten-1', workspaceId: 'wrk-1', actorId: 'actor-1', roles: ['workspace_viewer'] },
    db,
    kafkaProducer: { send: async () => {} },
    internalClient: {
      getApiSurface: async () => { const error = new Error('down'); error.statusCode = 503; throw error },
      getEffectiveCapabilities: async () => ({ capabilities: [] })
    }
  })
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.stale, true)
})
