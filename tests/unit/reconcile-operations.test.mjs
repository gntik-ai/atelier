import test from 'node:test'
import assert from 'node:assert/strict'

import { reconcileOperations } from '../../apps/web-console/src/lib/reconcile-operations.runtime.mjs'

function op(operationId, status) {
  return {
    operationId,
    status,
    operationType: 'workspace.create',
    tenantId: 'tenant-a',
    workspaceId: 'wrk-a',
    actorId: 'usr-1',
    actorType: 'tenant_owner',
    createdAt: '2026-03-30T10:00:00.000Z',
    updatedAt: '2026-03-30T10:00:00.000Z',
    correlationId: `corr-${operationId}`
  }
}

function snapshot(...operations) {
  return new Map(operations.map((operation) => [operation.operationId, operation]))
}

test('empty-delta', () => {
  const remote = [op('op-1', 'running'), op('op-2', 'pending')]
  const delta = reconcileOperations(snapshot(...remote), remote)
  assert.deepEqual(delta.updated, [])
  assert.deepEqual(delta.added, [])
  assert.deepEqual(delta.terminal, [])
  assert.deepEqual(delta.unavailable, [])
  assert.equal(delta.unchanged.length, 2)
})

test('state-transition-to-failed', () => {
  const delta = reconcileOperations(snapshot(op('op-1', 'running')), [op('op-1', 'failed')])
  assert.equal(delta.updated[0].status, 'failed')
  assert.equal(delta.terminal[0].status, 'failed')
})

test('state-transition-to-completed', () => {
  const delta = reconcileOperations(snapshot(op('op-1', 'running')), [op('op-1', 'completed')])
  assert.equal(delta.updated[0].status, 'completed')
  assert.equal(delta.terminal[0].status, 'completed')
})

test('state-transition-to-timed-out', () => {
  const delta = reconcileOperations(snapshot(op('op-1', 'running')), [op('op-1', 'timed_out')])
  assert.equal(delta.updated[0].status, 'timed_out')
  assert.equal(delta.terminal[0].status, 'timed_out')
})

test('state-transition-to-cancelled', () => {
  const delta = reconcileOperations(snapshot(op('op-1', 'running')), [op('op-1', 'cancelled')])
  assert.equal(delta.updated[0].status, 'cancelled')
  assert.equal(delta.terminal[0].status, 'cancelled')
})

test('non-terminal-update', () => {
  const delta = reconcileOperations(snapshot(op('op-1', 'pending')), [op('op-1', 'running')])
  assert.equal(delta.updated[0].status, 'running')
  assert.deepEqual(delta.terminal, [])
})

test('C-12 running-to-cancelling is updated but nonterminal', () => {
  const delta = reconcileOperations(snapshot(op('op-1', 'running')), [op('op-1', 'cancelling')])
  assert.equal(delta.updated[0].status, 'cancelling')
  assert.deepEqual(delta.terminal, [])
})

test('C-12 cancelling transitions to cancelled or failed are terminal', () => {
  for (const status of ['cancelled', 'failed']) {
    const delta = reconcileOperations(snapshot(op('op-1', 'cancelling')), [op('op-1', status)])
    assert.equal(delta.updated[0].status, status)
    assert.equal(delta.terminal[0].status, status)
  }
})

test('added-op', () => {
  const delta = reconcileOperations(snapshot(op('op-1', 'running')), [op('op-1', 'running'), op('op-2', 'pending')])
  assert.deepEqual(delta.added.map((item) => item.operationId), ['op-2'])
})

test('unavailable-op', () => {
  const delta = reconcileOperations(snapshot(op('op-1', 'running')), [])
  assert.deepEqual(delta.unavailable, ['op-1'])
})

test('idempotence', () => {
  const local = snapshot(op('op-1', 'pending'))
  const remote = [op('op-1', 'running')]
  assert.deepEqual(reconcileOperations(local, remote), reconcileOperations(local, remote))
})

test('multi-op-mixed', () => {
  const local = snapshot(op('op-1', 'running'), op('op-2', 'pending'), op('op-3', 'running'), op('op-4', 'pending'))
  const remote = [op('op-1', 'completed'), op('op-2', 'running'), op('op-3', 'running'), op('op-5', 'pending')]
  const delta = reconcileOperations(local, remote)
  assert.deepEqual(delta.updated.map((item) => item.operationId), ['op-1', 'op-2'])
  assert.deepEqual(delta.terminal.map((item) => item.operationId), ['op-1'])
  assert.deepEqual(delta.unchanged.map((item) => item.operationId), ['op-3'])
  assert.deepEqual(delta.added.map((item) => item.operationId), ['op-5'])
  assert.deepEqual(delta.unavailable, ['op-4'])
})

test('empty-local-snapshot', () => {
  const delta = reconcileOperations(new Map(), [op('op-1', 'running'), op('op-2', 'pending')])
  assert.deepEqual(delta.added.map((item) => item.operationId), ['op-1', 'op-2'])
})

test('empty-remote', () => {
  const delta = reconcileOperations(snapshot(op('op-1', 'running'), op('op-2', 'pending')), [])
  assert.deepEqual(delta.unavailable, ['op-1', 'op-2'])
})
