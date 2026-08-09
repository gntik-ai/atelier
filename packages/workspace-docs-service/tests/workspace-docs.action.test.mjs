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
    headers: { 'X-API-Version': '2026-03-26', 'X-Correlation-Id': 'corr-1' },
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

test('GET docs rejects the retired pre-C-03 version', async () => {
  const result = await main({ method: 'GET', path: '/v1/workspaces/wrk-1/docs', headers: { 'X-API-Version': '2026-03-01' }, auth: { tenantId: 'ten-1', workspaceId: 'wrk-1', actorId: 'actor-1', roles: ['workspace_viewer'] }, db: { query: async () => ({ rows: [] }) } })
  assert.equal(result.statusCode, 400)
})

test('GET docs accepts current console version and tenant owner gateway identity', async () => {
  const db = { query: async () => ({ rows: [], rowCount: 1 }) }
  const result = await main({
    method: 'GET',
    path: '/v1/workspaces/wrk-1/docs',
    headers: { 'X-API-Version': '2026-03-26', 'X-Correlation-Id': 'corr-1' },
    auth: { tenantId: 'ten-1', subject: 'actor-1', roles: ['tenant_owner'] },
    db,
    kafkaProducer: { send: async () => {} }
  })

  assert.equal(result.statusCode, 200)
  assert.equal(result.body.workspaceId, 'wrk-1')
  assert.equal(result.body.tenantId, 'ten-1')
  assert.equal(result.body.stale, false)
  assert.ok(result.body.enabledServices.some((service) => service.serviceKey === 'postgres-database'))
})

test('GET docs accepts the kind action-router params-auth-overrides shape', async () => {
  const queries = []
  const db = {
    query: async (sql) => {
      queries.push(sql)
      return { rows: [], rowCount: 1 }
    }
  }
  const result = await main({
    method: 'GET',
    path: '/v1/workspaces/wrk-kind/docs',
    workspaceId: 'wrk-kind',
    __ow_headers: {
      host: 'api.kind.test',
      'x-api-version': '2026-03-26',
      'x-correlation-id': 'corr-kind'
    },
    auth: { tenantId: 'ten-1', subject: 'actor-1', roles: ['tenant_owner'] }
  }, { db })

  assert.equal(result.statusCode, 200)
  assert.equal(result.body.workspaceId, 'wrk-kind')
  assert.equal(result.body.baseUrl, 'http://api.kind.test')
  assert.ok(result.body.enabledServices.some((service) => service.serviceKey === 'postgres-database'))
  assert.ok(queries.some((sql) => sql.includes('workspace_doc_notes')))
})

test('GET docs rejects mismatched auth workspace and path workspace', async () => {
  const result = await main({
    method: 'GET',
    path: '/v1/workspaces/wrk-path/docs',
    workspaceId: 'wrk-path',
    headers: { 'X-API-Version': '2026-03-26' },
    auth: { tenantId: 'ten-1', workspaceId: 'wrk-header', actorId: 'actor-1', roles: ['tenant_owner'] },
    db: { query: async () => ({ rows: [], rowCount: 1 }) }
  })

  assert.equal(result.statusCode, 403)
  assert.equal(result.body.code, 'FORBIDDEN')
})

test('GET docs returns stale 200 body when assembler degrades upstream', async () => {
  const db = { query: async () => ({ rows: [], rowCount: 1 }) }
  const result = await main({
    method: 'GET',
    path: '/v1/workspaces/wrk-1/docs',
    headers: { 'X-API-Version': '2026-03-26', 'X-Correlation-Id': 'corr-1' },
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
