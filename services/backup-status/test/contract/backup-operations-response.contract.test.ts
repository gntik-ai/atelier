import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/api/backup-status.auth.js', () => ({
  validateToken: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number
    constructor(msg: string, code: number) { super(msg); this.statusCode = code }
  },
}))

vi.mock('../../src/operations/operations.repository.js', () => ({
  findById: vi.fn(),
}))

vi.mock('../../src/adapters/registry.js', () => ({
  getCapabilities: vi.fn(),
  adapterRegistry: { get: vi.fn() },
  isActionAdapter: vi.fn(),
}))

import { validateToken } from '../../src/api/backup-status.auth.js'
import * as repo from '../../src/operations/operations.repository.js'
import { getCapabilities, isActionAdapter, adapterRegistry } from '../../src/adapters/registry.js'
import { main as getOperation } from '../../src/operations/get-operation.action.js'
import { main as listSnapshots } from '../../src/operations/list-snapshots.action.js'

const mockValidate = vi.mocked(validateToken)
const mockFindById = vi.mocked(repo.findById)
const mockCaps = vi.mocked(getCapabilities)
const mockIsAction = vi.mocked(isActionAdapter)
const mockGetAdapter = vi.mocked(adapterRegistry.get)

describe('Contract: operation response without technical scope', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not contain failure_reason, adapterOperationId, or metadata', async () => {
    mockValidate.mockResolvedValue({ sub: 'user-1', scopes: [], exp: 0, iat: 0 })
    mockFindById.mockResolvedValue({
      id: 'op-1', type: 'backup', tenantId: 'tenant-a', componentType: 'postgresql',
      instanceId: 'pg-1', status: 'failed', requesterId: 'user-1', requesterRole: 'tenant_owner',
      snapshotId: null, failureReason: 'SECRET_INTERNAL_ERROR', failureReasonPublic: 'Something went wrong',
      adapterOperationId: 'internal-k8s-id', acceptedAt: new Date('2026-01-01T00:00:00Z'),
      inProgressAt: new Date('2026-01-01T00:00:01Z'), completedAt: null,
      failedAt: new Date('2026-01-01T00:00:05Z'), metadata: { internal: 'secret' },
    })

    const res = await getOperation({ __ow_headers: { authorization: 'Bearer t' }, id: 'op-1' })

    expect(res.statusCode).toBe(200)
    const body = res.body as any
    const op = body.operation

    // Contract: these fields MUST NOT appear
    expect(op.failure_reason).toBeUndefined()
    expect(op.adapter_operation_id).toBeUndefined()
    expect(op.adapterOperationId).toBeUndefined()
    expect(op.metadata).toBeUndefined()

    // Contract: these fields MUST appear
    expect(op.failure_reason_public).toBe('Something went wrong')
    expect(op.id).toBe('op-1')
    expect(op.schema_version).toBeUndefined() // schema_version is at root
    expect(body.schema_version).toBe('1')
  })
})

describe('Contract: snapshots response', () => {
  beforeEach(() => vi.clearAllMocks())

  it('each snapshot has snapshot_id, created_at, available and no internal fields', async () => {
    mockValidate.mockResolvedValue({ sub: 'user-1', scopes: ['backup-status:read:global'], exp: 0, iat: 0 })
    mockCaps.mockReturnValue({ triggerBackup: true, triggerRestore: true, listSnapshots: true })

    const mockAdapter = {
      listSnapshots: vi.fn().mockResolvedValue([
        { snapshotId: 'snap-1', createdAt: new Date('2026-01-01T00:00:00Z'), available: true, sizeBytes: 1024 },
      ]),
    }
    mockGetAdapter.mockReturnValue(mockAdapter as any)
    mockIsAction.mockReturnValue(true)

    const res = await listSnapshots({
      __ow_headers: { authorization: 'Bearer t' },
      tenant_id: 'tenant-a', component_type: 'postgresql', instance_id: 'pg-1',
    })

    expect(res.statusCode).toBe(200)
    const body = res.body as any
    const snap = body.snapshots[0]

    // Contract: required fields
    expect(snap.snapshot_id).toBe('snap-1')
    expect(snap.created_at).toBeDefined()
    expect(typeof snap.available).toBe('boolean')

    // Contract: no internal fields
    expect(snap.storagePath).toBeUndefined()
    expect(snap.namespace).toBeUndefined()
    expect(snap.credentials).toBeUndefined()
    expect(snap.connectionString).toBeUndefined()
  })
})
