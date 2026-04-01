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

import { validateToken } from '../../../src/api/backup-status.auth.js'
import { getCapabilities, isActionAdapter, adapterRegistry } from '../../../src/adapters/registry.js'
import { main } from '../../../src/operations/list-snapshots.action.js'

const mockValidate = vi.mocked(validateToken)
const mockCaps = vi.mocked(getCapabilities)
const mockIsAction = vi.mocked(isActionAdapter)
const mockGetAdapter = vi.mocked(adapterRegistry.get)

describe('list-snapshots.action', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 403 without backup-status:read:global scope', async () => {
    mockValidate.mockResolvedValue({ sub: 'user-1', scopes: [], exp: 0, iat: 0 })

    const res = await main({
      __ow_headers: { authorization: 'Bearer t' },
      tenant_id: 'tenant-a', component_type: 'postgresql', instance_id: 'pg-1',
    })

    expect(res.statusCode).toBe(403)
  })

  it('returns 422 when adapter does not support listSnapshots', async () => {
    mockValidate.mockResolvedValue({ sub: 'user-1', scopes: ['backup-status:read:global'], exp: 0, iat: 0 })
    mockCaps.mockReturnValue({ triggerBackup: false, triggerRestore: false, listSnapshots: false })

    const res = await main({
      __ow_headers: { authorization: 'Bearer t' },
      tenant_id: 'tenant-a', component_type: 'redis', instance_id: 'r-1',
    })

    expect(res.statusCode).toBe(422)
  })

  it('CA-05: returns sanitized snapshots with schema v1', async () => {
    mockValidate.mockResolvedValue({ sub: 'user-1', scopes: ['backup-status:read:global'], exp: 0, iat: 0 })
    mockCaps.mockReturnValue({ triggerBackup: true, triggerRestore: true, listSnapshots: true })

    const mockAdapter = {
      listSnapshots: vi.fn().mockResolvedValue([
        { snapshotId: 'snap-1', createdAt: new Date('2026-01-01T00:00:00Z'), available: true, sizeBytes: 1024, label: 'Backup completado' },
        { snapshotId: 'snap-2', createdAt: new Date('2026-01-02T00:00:00Z'), available: false, label: 'Running' },
      ]),
    }
    mockGetAdapter.mockReturnValue(mockAdapter as any)
    mockIsAction.mockReturnValue(true)

    const res = await main({
      __ow_headers: { authorization: 'Bearer t' },
      tenant_id: 'tenant-a', component_type: 'postgresql', instance_id: 'pg-1',
    })

    expect(res.statusCode).toBe(200)
    const body = res.body as any
    expect(body.schema_version).toBe('1')
    expect(body.snapshots).toHaveLength(2)
    expect(body.snapshots[0].snapshot_id).toBe('snap-1')
    expect(body.snapshots[0].available).toBe(true)
    expect(body.snapshots[1].available).toBe(false)
    // No internal fields leaked
    expect(body.snapshots[0].namespace).toBeUndefined()
    expect(body.snapshots[0].storagePath).toBeUndefined()
  })
})
