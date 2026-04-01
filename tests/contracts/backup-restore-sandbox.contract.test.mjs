import test from 'node:test'
import assert from 'node:assert/strict'

function makeJwtLikeToken(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`
}

test('simulation status response is additive over the base operation contract', async () => {
  process.env.TEST_MODE = 'true'
  const { setClient } = await import('../../services/backup-status/src/operations/operations.repository.js')
  const { main } = await import('../../services/backup-status/src/operations/get-operation.action.js')

  setClient({
    async query() {
      return {
        rows: [{
          id: 'op-sim-contract',
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
            target_environment: 'integration',
            validation_summary: {
              outcome: 'warning',
              checkedAt: '2026-04-01T10:02:00.000Z',
              checkedBy: 'actor-1',
              environment: 'integration',
              snapshotId: 'snap-001',
              checks: [],
            },
            evidence_refs: [],
          },
        }],
      }
    },
  })

  const response = await main({
    id: 'op-sim-contract',
    __ow_headers: { Authorization: `Bearer ${makeJwtLikeToken({ sub: 'actor-1', scopes: ['backup:read:global'] })}` },
  })

  assert.equal(response.statusCode, 200)
  const keys = Object.keys(response.body.operation)
  assert.equal(keys.includes('id'), true)
  assert.equal(keys.includes('type'), true)
  assert.equal(keys.includes('status'), true)
  assert.equal(keys.includes('execution_mode'), true)
  assert.equal(keys.includes('validation_summary'), true)
  assert.equal(keys.includes('evidence_refs'), true)
  assert.equal(response.body.operation.execution_mode, 'simulation')
  assert.equal(response.body.operation.target_environment, 'integration')
  assert.equal(response.body.operation.failure_reason_public, null)

  setClient(null)
  delete process.env.TEST_MODE
})

test('unsafe simulation profiles surface a clear rejection contract', async () => {
  const { runRestoreSimulation } = await import('../../services/backup-status/src/operations/restore-simulation.service.js')

  await assert.rejects(
    () => runRestoreSimulation({
      operation: {
        id: 'op-sim-contract-2',
        type: 'restore',
        tenantId: 'tenant-demo',
        componentType: 'postgresql',
        instanceId: 'pg-01',
        status: 'accepted',
        requesterId: 'actor-1',
        requesterRole: 'sre',
        snapshotId: 'snap-001',
        acceptedAt: new Date('2026-04-01T10:00:00.000Z'),
      },
      deploymentProfile: 'production',
      actorId: 'actor-1',
    }),
    (err) => err.statusCode === 403 && err.code === 'restore_simulation_profile_not_allowed',
  )
})
