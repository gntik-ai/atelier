import test from 'node:test'
import assert from 'node:assert/strict'

function makeJwtLikeToken(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`
}

test('restore simulation service produces safe evidence for sandbox profiles', async () => {
  const { runRestoreSimulation } = await import('../../services/backup-status/src/operations/restore-simulation.service.js')

  const operation = {
    id: 'op-sim-001',
    type: 'restore',
    tenantId: 'tenant-demo',
    componentType: 'postgresql',
    instanceId: 'pg-01',
    status: 'accepted',
    requesterId: 'actor-1',
    requesterRole: 'sre',
    snapshotId: 'snap-001',
    acceptedAt: new Date('2026-04-01T10:00:00.000Z'),
    metadata: {
      execution_mode: 'simulation',
      target_environment: 'sandbox',
      evidence_refs: [],
      validation_summary: null,
    },
  }

  const result = await runRestoreSimulation({
    operation,
    deploymentProfile: 'sandbox',
    actorId: 'actor-1',
  })

  assert.equal(result.status, 'completed')
  assert.equal(result.targetEnvironment, 'sandbox')
  assert.equal(result.validationSummary.outcome, 'completed')
  assert.equal(result.validationSummary.environment, 'sandbox')
  assert.equal(result.validationSummary.snapshotId, 'snap-001')
  assert.equal(result.validationSummary.checks.length >= 3, true)
  assert.equal(result.evidenceRefs.some((ref) => ref.kind === 'operation'), true)
  assert.equal(result.evidenceRefs.some((ref) => ref.kind === 'snapshot'), true)
})

test('restore simulation service rejects unsafe deployment profiles', async () => {
  const { runRestoreSimulation, RestoreSimulationError } = await import('../../services/backup-status/src/operations/restore-simulation.service.js')

  const operation = {
    id: 'op-sim-002',
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

  await assert.rejects(
    () => runRestoreSimulation({
      operation,
      deploymentProfile: 'production',
      actorId: 'actor-1',
    }),
    (err) => err instanceof RestoreSimulationError && err.statusCode === 403 && err.code === 'restore_simulation_profile_not_allowed',
  )
})

test('operation status serializes simulation metadata and evidence', async () => {
  process.env.TEST_MODE = 'true'
  const { setClient } = await import('../../services/backup-status/src/operations/operations.repository.js')
  const { main } = await import('../../services/backup-status/src/operations/get-operation.action.js')

  setClient({
    async query(sql, params) {
      assert.match(sql, /SELECT \* FROM backup_operations WHERE id = \$1/)
      assert.deepEqual(params, ['op-sim-003'])
      return {
        rows: [{
          id: 'op-sim-003',
          type: 'restore',
          tenant_id: 'tenant-demo',
          component_type: 'postgresql',
          instance_id: 'pg-01',
          status: 'completed',
          requester_id: 'actor-1',
          requester_role: 'sre',
          snapshot_id: 'snap-001',
          failure_reason: null,
          failure_reason_public: null,
          adapter_operation_id: null,
          accepted_at: '2026-04-01T10:00:00.000Z',
          in_progress_at: '2026-04-01T10:01:00.000Z',
          completed_at: '2026-04-01T10:02:00.000Z',
          failed_at: null,
          metadata: {
            execution_mode: 'simulation',
            target_environment: 'sandbox',
            validation_summary: {
              outcome: 'completed',
              checkedAt: '2026-04-01T10:02:00.000Z',
              checkedBy: 'actor-1',
              environment: 'sandbox',
              snapshotId: 'snap-001',
              checks: [{ code: 'target_isolated', result: 'ok', message: 'ok' }],
            },
            evidence_refs: [
              { kind: 'operation', id: 'op-sim-003', label: 'Simulación de restore' },
            ],
          },
        }],
      }
    },
  })

  const token = makeJwtLikeToken({
    sub: 'actor-1',
    scopes: ['backup:read:global', 'backup-status:read:technical'],
  })

  const response = await main({
    id: 'op-sim-003',
    __ow_headers: { Authorization: `Bearer ${token}` },
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.body.operation.execution_mode, 'simulation')
  assert.equal(response.body.operation.target_environment, 'sandbox')
  assert.equal(response.body.operation.validation_summary.outcome, 'completed')
  assert.equal(response.body.operation.evidence_refs.length, 1)
  assert.equal(response.body.operation.failure_reason, null)

  setClient(null)
  delete process.env.TEST_MODE
})

// Safety regression: the simulation branch must never enter the destructive adapter path.
test('simulation dispatcher bypasses the destructive restore adapter path', async () => {
  const { setClient } = await import('../../services/backup-status/src/operations/operations.repository.js')
  const { dispatch } = await import('../../services/backup-status/src/operations/operation-dispatcher.js')
  const { adapterRegistry } = await import('../../services/backup-status/src/adapters/registry.js')
  const { setPool } = await import('../../services/backup-status/src/audit/audit-trail.repository.js')

  setPool({
    async query() {
      return { rows: [] }
    },
  })

  const store = new Map([
    ['op-sim-dispatch', {
      id: 'op-sim-dispatch',
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
      metadata: { execution_mode: 'simulation', target_environment: 'sandbox', validation_summary: null, evidence_refs: [] },
    }],
  ])

  setClient({
    async query(sql, params) {
      if (/SELECT \* FROM backup_operations WHERE id = \$1/.test(sql)) {
        return { rows: [store.get(params[0])] }
      }
      if (/UPDATE backup_operations SET/.test(sql)) {
        const row = store.get(params[0])
        row.status = params[1]
        if (sql.includes('in_progress_at = NOW()')) row.in_progress_at = '2026-04-01T10:01:00.000Z'
        if (sql.includes('completed_at = NOW()')) row.completed_at = '2026-04-01T10:02:00.000Z'
        if (sql.includes("metadata = COALESCE(metadata, '{}'::jsonb) ||")) {
          const patch = JSON.parse(String(params[params.length - 1]))
          row.metadata = { ...row.metadata, ...patch }
        }
        return { rows: [row] }
      }
      return { rows: [] }
    },
  })

  const originalGet = adapterRegistry.get.bind(adapterRegistry)
  adapterRegistry.get = () => ({
    componentType: 'postgresql',
    instanceLabel: 'should-not-be-called',
    async check() {
      return { status: 'not_available' }
    },
    capabilities() {
      throw new Error('destructive adapter path should not be used for simulation')
    },
    async triggerBackup() {
      throw new Error('destructive adapter path should not be used for simulation')
    },
    async triggerRestore() {
      throw new Error('destructive adapter path should not be used for simulation')
    },
    async listSnapshots() {
      throw new Error('destructive adapter path should not be used for simulation')
    },
  })

  await dispatch('op-sim-dispatch')

  const persisted = store.get('op-sim-dispatch')
  assert.equal(persisted.status, 'completed')
  assert.equal(persisted.metadata.execution_mode, 'simulation')
  assert.equal(persisted.metadata.validation_summary.outcome, 'completed')
  assert.equal(persisted.metadata.evidence_refs.length, 3)

  adapterRegistry.get = originalGet
  setClient(null)
})

