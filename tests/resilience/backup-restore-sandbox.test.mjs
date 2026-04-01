import test from 'node:test'
import assert from 'node:assert/strict'

function makeOperation(id = 'op-sim-resilience') {
  return {
    id,
    type: 'restore',
    tenantId: 'tenant-demo',
    componentType: 'postgresql',
    instanceId: 'pg-01',
    status: 'accepted',
    requesterId: 'actor-1',
    requesterRole: 'sre',
    snapshotId: 'snap-001',
    acceptedAt: new Date('2026-04-01T10:00:00.000Z'),
  }
}

test('unsafe simulation profiles are rejected deterministically', async () => {
  const { runRestoreSimulation, RestoreSimulationError } = await import('../../services/backup-status/src/operations/restore-simulation.service.js')

  const attempt = () => runRestoreSimulation({
    operation: makeOperation(),
    deploymentProfile: 'production',
    actorId: 'actor-1',
  })

  await assert.rejects(attempt, (err) => err instanceof RestoreSimulationError && err.statusCode === 403)
  await assert.rejects(attempt, (err) => err instanceof RestoreSimulationError && err.statusCode === 403)
})

test('operation metadata patch is merged instead of replaced during persistence', async () => {
  const { setClient, updateStatus } = await import('../../services/backup-status/src/operations/operations.repository.js')

  const queries = []
  const store = new Map([
    ['op-sim-meta', {
      id: 'op-sim-meta',
      type: 'restore',
      tenant_id: 'tenant-demo',
      component_type: 'postgresql',
      instance_id: 'pg-01',
      status: 'accepted',
      requester_id: 'actor-1',
      requester_role: 'sre',
      snapshot_id: 'snap-001',
      failure_reason: null,
      failure_reason_public: null,
      adapter_operation_id: null,
      accepted_at: '2026-04-01T10:00:00.000Z',
      in_progress_at: null,
      completed_at: null,
      failed_at: null,
      metadata: { execution_mode: 'simulation', target_environment: 'sandbox' },
    }],
  ])
  setClient({
    async query(sql, params) {
      queries.push({ sql, params })
      if (/UPDATE backup_operations SET/.test(sql)) {
        const row = store.get(params[0])
        const patch = JSON.parse(String(params[params.length - 1]))
        row.status = params[1]
        row.completed_at = '2026-04-01T10:01:00.000Z'
        row.metadata = { ...row.metadata, ...patch }
        return { rows: [row] }
      }
      return { rows: [] }
    },
  })

  const updated = await updateStatus('op-sim-meta', 'completed', {
    metadataPatch: {
      validation_summary: { outcome: 'completed' },
      evidence_refs: [{ kind: 'operation', id: 'op-sim-meta' }],
    },
  })

  assert.equal(updated.metadata.execution_mode, 'simulation')
  assert.equal(updated.metadata.target_environment, 'sandbox')
  assert.equal(updated.metadata.validation_summary.outcome, 'completed')
  assert.equal(updated.metadata.evidence_refs.length, 1)
  assert.match(queries[0].sql, /metadata = COALESCE\(metadata, '\{\}'::jsonb\) \|\| \$[0-9]+::jsonb/)

  setClient(null)
})
