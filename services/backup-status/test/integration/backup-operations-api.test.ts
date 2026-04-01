/**
 * Integration tests for backup operations API.
 * Uses in-memory mock DB — no live database required.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { setClient } from '../../src/operations/operations.repository.js'
import { adapterRegistry } from '../../src/adapters/registry.js'
import { postgresqlAdapter } from '../../src/adapters/postgresql.adapter.js'
import { main as triggerBackup } from '../../src/operations/trigger-backup.action.js'
import { main as triggerRestore } from '../../src/operations/trigger-restore.action.js'
import { main as getOperation } from '../../src/operations/get-operation.action.js'

// Set test mode so token validation uses base64 JSON
process.env.TEST_MODE = 'true'
process.env.BACKUP_ENABLED = 'true'

function makeToken(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encoded}.signature`
}

const sreToken = makeToken({
  sub: 'user-sre-1',
  tenant_id: 'platform',
  scopes: ['backup:write:global', 'backup:restore:global', 'backup-status:read:global', 'backup:read:global', 'backup-status:read:technical'],
  exp: Math.floor(Date.now() / 1000) + 3600,
})

const tenantOwnerToken = makeToken({
  sub: 'user-t1',
  tenant_id: 'tenant-1',
  scopes: ['backup:write:own'],
  exp: Math.floor(Date.now() / 1000) + 3600,
})

const tenantAToken = makeToken({
  sub: 'user-tenant-a',
  tenant_id: 'tenant-A',
  scopes: ['backup:write:own'],
  exp: Math.floor(Date.now() / 1000) + 3600,
})

// In-memory mock DB
const dbStore = new Map<string, Record<string, unknown>>()
let idCounter = 0

const mockClient = {
  async query(text: string, params?: unknown[]) {
    const p = params ?? []
    if (text.includes('INSERT INTO backup_operations')) {
      const id = `op-${++idCounter}`
      const record: Record<string, unknown> = {
        id,
        type: p[0],
        tenant_id: p[1],
        component_type: p[2],
        instance_id: p[3],
        status: 'accepted',
        requester_id: p[4],
        requester_role: p[5],
        snapshot_id: p[6] ?? null,
        failure_reason: null,
        failure_reason_public: null,
        adapter_operation_id: null,
        accepted_at: new Date().toISOString(),
        in_progress_at: null,
        completed_at: null,
        failed_at: null,
        metadata: null,
      }
      dbStore.set(id, record)
      return { rows: [record] }
    }
    if (text.includes('SELECT * FROM backup_operations WHERE id = $1')) {
      const record = dbStore.get(p[0] as string)
      return { rows: record ? [record] : [] }
    }
    if (text.includes('WHERE status IN')) {
      const records = [...dbStore.values()].filter(
        (r) =>
          r.tenant_id === p[0] &&
          r.component_type === p[1] &&
          r.instance_id === p[2] &&
          r.type === p[3] &&
          ['accepted', 'in_progress'].includes(r.status as string),
      )
      return { rows: records }
    }
    if (text.includes('UPDATE backup_operations')) {
      const id = p[0] as string
      const record = dbStore.get(id)
      if (record) {
        record.status = p[1]
        dbStore.set(id, record)
      }
      return { rows: record ? [record] : [] }
    }
    return { rows: [] }
  },
}

beforeAll(() => {
  setClient(mockClient)
  adapterRegistry.register(postgresqlAdapter)
})

describe('Backup Operations API Integration', () => {
  it('CA-01: POST /trigger → 202 + operation_id', async () => {
    const res = await triggerBackup({
      __ow_headers: { authorization: `Bearer ${sreToken}` },
      tenant_id: 'tenant-1',
      component_type: 'postgresql',
      instance_id: 'pg-1',
    })
    expect(res.statusCode).toBe(202)
    expect((res.body as Record<string, unknown>).operation_id).toBeDefined()
    expect((res.body as Record<string, unknown>).status).toBe('accepted')
  })

  it('CA-01: GET /operations/:id → accepted', async () => {
    const trigRes = await triggerBackup({
      __ow_headers: { authorization: `Bearer ${sreToken}` },
      tenant_id: 'tenant-2',
      component_type: 'postgresql',
      instance_id: 'pg-2',
    })
    const operationId = (trigRes.body as Record<string, unknown>).operation_id as string

    const getRes = await getOperation({
      __ow_headers: { authorization: `Bearer ${sreToken}` },
      id: operationId,
    })
    expect(getRes.statusCode).toBe(200)
    const opBody = (getRes.body as { operation: Record<string, unknown> }).operation
    expect(opBody.status).toBe('accepted')
  })

  it('CA-07: concurrent operation → 409 with conflict_operation_id', async () => {
    const first = await triggerBackup({
      __ow_headers: { authorization: `Bearer ${sreToken}` },
      tenant_id: 'tenant-3',
      component_type: 'postgresql',
      instance_id: 'pg-3',
    })
    expect(first.statusCode).toBe(202)

    const second = await triggerBackup({
      __ow_headers: { authorization: `Bearer ${sreToken}` },
      tenant_id: 'tenant-3',
      component_type: 'postgresql',
      instance_id: 'pg-3',
    })
    expect(second.statusCode).toBe(409)
    expect((second.body as Record<string, unknown>).conflict_operation_id).toBeDefined()
  })

  it('CA-09: tenant_owner operating on another tenant → 403', async () => {
    const res = await triggerBackup({
      __ow_headers: { authorization: `Bearer ${tenantAToken}` },
      tenant_id: 'tenant-B',
      component_type: 'postgresql',
      instance_id: 'pg-1',
    })
    expect(res.statusCode).toBe(403)
  })

  it('CA-03: POST /restore with tenant_owner → 403', async () => {
    const res = await triggerRestore({
      __ow_headers: { authorization: `Bearer ${tenantOwnerToken}` },
      tenant_id: 'tenant-1',
      component_type: 'postgresql',
      instance_id: 'pg-1',
      snapshot_id: 'snap-001',
    })
    expect(res.statusCode).toBe(403)
  })
})
