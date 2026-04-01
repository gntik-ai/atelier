import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/api/backup-status.auth.js', () => ({
  validateToken: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number
    constructor(msg: string, code: number) { super(msg); this.statusCode = code }
  },
}))

vi.mock('../../../src/adapters/registry.js', () => ({
  getCapabilities: vi.fn(),
  adapterRegistry: { get: vi.fn() },
  isActionAdapter: vi.fn(),
}))

vi.mock('../../../src/operations/operations.repository.js', () => ({
  findActive: vi.fn(),
  create: vi.fn(),
}))

vi.mock('../../../src/operations/operation-dispatcher.js', () => ({
  dispatch: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../src/shared/audit.js', () => ({
  logAccessEvent: vi.fn().mockResolvedValue(undefined),
}))

import { validateToken } from '../../../src/api/backup-status.auth.js'
import { getCapabilities, isActionAdapter, adapterRegistry } from '../../../src/adapters/registry.js'
import * as repo from '../../../src/operations/operations.repository.js'
import { main } from '../../../src/operations/trigger-restore.action.js'

const mockValidate = vi.mocked(validateToken)
const mockCaps = vi.mocked(getCapabilities)
const mockFindActive = vi.mocked(repo.findActive)
const mockCreate = vi.mocked(repo.create)
const mockIsAction = vi.mocked(isActionAdapter)
const mockGetAdapter = vi.mocked(adapterRegistry.get)

function makeParams(body: Record<string, string>, token = 'Bearer test') {
  return {
    __ow_headers: { authorization: token },
    __ow_body: Buffer.from(JSON.stringify(body)).toString('base64'),
  }
}

describe('trigger-restore.action', () => {
  beforeEach(() => vi.clearAllMocks())

  it('CA-03: POST /restore with tenant_owner token → 403', async () => {
    mockValidate.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-a', scopes: ['backup:write:own'], exp: 0, iat: 0 })

    const res = await main(makeParams({
      tenant_id: 'tenant-a', component_type: 'postgresql', instance_id: 'pg-1', snapshot_id: 'snap-1',
    }))

    expect(res.statusCode).toBe(403)
  })

  it('CA-02: POST /restore with SRE token + valid snapshot → 202', async () => {
    mockValidate.mockResolvedValue({ sub: 'sre-1', tenantId: undefined, scopes: ['backup:restore:global'], exp: 0, iat: 0 })
    mockCaps.mockReturnValue({ triggerBackup: true, triggerRestore: true, listSnapshots: true })
    mockFindActive.mockResolvedValue(null)

    const mockAdapter = {
      listSnapshots: vi.fn().mockResolvedValue([
        { snapshotId: 'snap-1', createdAt: new Date(), available: true },
      ]),
    }
    mockGetAdapter.mockReturnValue(mockAdapter as any)
    mockIsAction.mockReturnValue(true)

    mockCreate.mockResolvedValue({
      id: 'op-restore-1', type: 'restore', tenantId: 'tenant-a', componentType: 'postgresql',
      instanceId: 'pg-1', status: 'accepted', requesterId: 'sre-1', requesterRole: 'sre',
      snapshotId: 'snap-1', failureReason: null, failureReasonPublic: null, adapterOperationId: null,
      acceptedAt: new Date('2026-01-01T00:00:00Z'), inProgressAt: null, completedAt: null, failedAt: null, metadata: null,
    })

    const res = await main(makeParams({
      tenant_id: 'tenant-a', component_type: 'postgresql', instance_id: 'pg-1', snapshot_id: 'snap-1',
    }))

    expect(res.statusCode).toBe(202)
    expect((res.body as any).operation_id).toBe('op-restore-1')
  })

  it('CA-08: POST /restore with non-existent snapshot → 422', async () => {
    mockValidate.mockResolvedValue({ sub: 'sre-1', scopes: ['backup:restore:global'], exp: 0, iat: 0 })
    mockCaps.mockReturnValue({ triggerBackup: true, triggerRestore: true, listSnapshots: true })
    mockFindActive.mockResolvedValue(null)

    const mockAdapter = {
      listSnapshots: vi.fn().mockResolvedValue([
        { snapshotId: 'snap-other', createdAt: new Date(), available: true },
      ]),
    }
    mockGetAdapter.mockReturnValue(mockAdapter as any)
    mockIsAction.mockReturnValue(true)

    const res = await main(makeParams({
      tenant_id: 'tenant-a', component_type: 'postgresql', instance_id: 'pg-1', snapshot_id: 'snap-missing',
    }))

    expect(res.statusCode).toBe(422)
    expect((res.body as any).error).toBe('snapshot_not_available')
  })

  it('rejects unsupported component with 422', async () => {
    mockValidate.mockResolvedValue({ sub: 'sre-1', scopes: ['backup:restore:global'], exp: 0, iat: 0 })
    mockCaps.mockReturnValue({ triggerBackup: false, triggerRestore: false, listSnapshots: false })

    const res = await main(makeParams({
      tenant_id: 'tenant-a', component_type: 'redis', instance_id: 'r-1', snapshot_id: 'snap-1',
    }))

    expect(res.statusCode).toBe(422)
  })
})
