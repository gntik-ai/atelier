import test from 'node:test'
import assert from 'node:assert/strict'

function makeJwtLikeToken(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`
}

test('simulation metadata persists through repository update and status query', async () => {
  process.env.TEST_MODE = 'true'
  const store = new Map()
  const { setClient, create, updateStatus } = await import('../../services/backup-status/src/operations/operations.repository.js')
  const { main: getOperation } = await import('../../services/backup-status/src/operations/get-operation.action.js')

  setClient({
    async query(sql, params) {
      if (/INSERT INTO backup_operations/.test(sql)) {
        const id = 'op-sim-integration'
        const row = {
          id,
          type: params[0],
          tenant_id: params[1],
          component_type: params[2],
          instance_id: params[3],
          requester_id: params[4],
          requester_role: params[5],
          snapshot_id: params[6],
          status: 'accepted',
          accepted_at: '2026-04-01T10:00:00.000Z',
          in_progress_at: null,
          completed_at: null,
          failed_at: null,
          failure_reason: null,
          failure_reason_public: null,
          adapter_operation_id: null,
          metadata: JSON.parse(String(params[7])),
        }
        store.set(id, row)
        return { rows: [row] }
      }
      if (/UPDATE backup_operations SET/.test(sql)) {
        const row = store.get(params[0])
        assert.ok(row)
        row.status = params[1]
        if (sql.includes('completed_at = NOW()')) row.completed_at = '2026-04-01T10:01:00.000Z'
        if (sql.includes('failure_reason =')) row.failure_reason = params.find((v) => typeof v === 'string' && v.includes('timeout')) ?? row.failure_reason
        if (sql.includes("metadata = COALESCE(metadata, '{}'::jsonb) ||")) {
          const patch = JSON.parse(String(params[params.length - 1]))
          row.metadata = { ...row.metadata, ...patch }
        }
        return { rows: [row] }
      }
      if (/SELECT \* FROM backup_operations WHERE id = \$1/.test(sql)) {
        return { rows: [store.get(params[0])] }
      }
      return { rows: [] }
    },
  })

  const created = await create({
    type: 'restore',
    tenantId: 'tenant-demo',
    componentType: 'postgresql',
    instanceId: 'pg-01',
    requesterId: 'actor-1',
    requesterRole: 'sre',
    snapshotId: 'snap-001',
    metadata: {
      execution_mode: 'simulation',
      target_environment: 'integration',
      validation_summary: null,
      evidence_refs: [],
    },
  })

  await updateStatus(created.id, 'completed', {
    metadataPatch: {
      validation_summary: {
        outcome: 'completed',
        checkedAt: '2026-04-01T10:01:00.000Z',
        checkedBy: 'actor-1',
        environment: 'integration',
        snapshotId: 'snap-001',
        checks: [{ code: 'target_isolated', result: 'ok', message: 'ok' }],
      },
      evidence_refs: [{ kind: 'operation', id: created.id }],
    },
  })

  const response = await getOperation({
    id: created.id,
    __ow_headers: { Authorization: `Bearer ${makeJwtLikeToken({ sub: 'actor-1', scopes: ['backup:read:global'] })}` },
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.body.operation.execution_mode, 'simulation')
  assert.equal(response.body.operation.target_environment, 'integration')
  assert.equal(response.body.operation.validation_summary.checks.length, 1)
  assert.equal(response.body.operation.evidence_refs.length, 1)
  assert.equal(response.body.operation.status, 'completed')

  setClient(null)
  delete process.env.TEST_MODE
})
