import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/api/backup-status.auth.js', () => ({
  validateToken: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number
    constructor(msg: string, code: number) { super(msg); this.statusCode = code }
  },
}))

vi.mock('../../../src/operations/operations.repository.js', () => ({
  findById: vi.fn(),
}))

import { validateToken } from '../../../src/api/backup-status.auth.js'
import * as repo from '../../../src/operations/operations.repository.js'
import { main } from '../../../src/operations/get-operation.action.js'
import type { OperationRecord } from '../../../src/operations/operations.types.js'

const mockValidate = vi.mocked(validateToken)
const mockFindById = vi.mocked(repo.findById)

function makeOp(overrides: Partial<OperationRecord> = {}): OperationRecord {
  return {
    id: 'op-1', type: 'backup', tenantId: 'tenant-a', componentType: 'postgresql',
    instanceId: 'pg-1', status: 'failed', requesterId: 'user-1', requesterRole: 'sre',
    snapshotId: null, failureReason: 'K8s API 500', failureReasonPublic: 'Operation failed',
    adapterOperationId: 'k8s-bk-1', acceptedAt: new Date('2026-01-01T00:00:00Z'),
    inProgressAt: new Date('2026-01-01T00:00:01Z'), completedAt: null,
    failedAt: new Date('2026-01-01T00:00:05Z'), metadata: { internal: true },
    ...overrides,
  }
}

describe('get-operation.action', () => {
  beforeEach(() => vi.clearAllMocks())

  it('CA-12: technical token includes failure_reason', async () => {
    mockValidate.mockResolvedValue({ sub: 'user-1', scopes: ['backup-status:read:technical'], exp: 0, iat: 0 })
    mockFindById.mockResolvedValue(makeOp())

    const res = await main({ __ow_headers: { authorization: 'Bearer t' }, id: 'op-1' })

    expect(res.statusCode).toBe(200)
    const body = res.body as any
    expect(body.operation.failure_reason).toBe('K8s API 500')
  })

  it('CA-12: tenant_owner token omits failure_reason', async () => {
    mockValidate.mockResolvedValue({ sub: 'user-1', scopes: [], exp: 0, iat: 0 })
    mockFindById.mockResolvedValue(makeOp())

    const res = await main({ __ow_headers: { authorization: 'Bearer t' }, id: 'op-1' })

    expect(res.statusCode).toBe(200)
    const body = res.body as any
    expect(body.operation.failure_reason).toBeUndefined()
    expect(body.operation.failure_reason_public).toBe('Operation failed')
  })

  it('returns 404 for non-existent operation', async () => {
    mockValidate.mockResolvedValue({ sub: 'user-1', scopes: ['backup:read:global'], exp: 0, iat: 0 })
    mockFindById.mockResolvedValue(null)

    const res = await main({ __ow_headers: { authorization: 'Bearer t' }, id: 'op-nonexist' })

    expect(res.statusCode).toBe(404)
  })

  it('returns 403 when requester is not owner and lacks global read', async () => {
    mockValidate.mockResolvedValue({ sub: 'other-user', scopes: [], exp: 0, iat: 0 })
    mockFindById.mockResolvedValue(makeOp())

    const res = await main({ __ow_headers: { authorization: 'Bearer t' }, id: 'op-1' })

    expect(res.statusCode).toBe(403)
  })

  it('does not include adapterOperationId or metadata in response', async () => {
    mockValidate.mockResolvedValue({ sub: 'user-1', scopes: [], exp: 0, iat: 0 })
    mockFindById.mockResolvedValue(makeOp())

    const res = await main({ __ow_headers: { authorization: 'Bearer t' }, id: 'op-1' })

    const body = res.body as any
    expect(body.operation.adapterOperationId).toBeUndefined()
    expect(body.operation.adapter_operation_id).toBeUndefined()
    expect(body.operation.metadata).toBeUndefined()
  })
})
