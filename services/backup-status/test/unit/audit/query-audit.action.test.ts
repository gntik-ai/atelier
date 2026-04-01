import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn().mockResolvedValue({
  schemaVersion: '1',
  events: [],
  pagination: { limit: 50, nextCursor: null },
})

vi.mock('../../../src/audit/audit-trail.repository.js', () => ({
  AuditTrailRepository: {
    query: (...args: unknown[]) => mockQuery(...args),
  },
}))

vi.mock('../../../src/api/backup-status.auth.js', () => ({
  validateToken: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number
    constructor(msg: string, code: number) { super(msg); this.statusCode = code }
  },
}))

import { main } from '../../../src/operations/query-audit.action.js'
import { validateToken } from '../../../src/api/backup-status.auth.js'

const mockValidateToken = vi.mocked(validateToken)

function makeParams(overrides: Record<string, unknown> = {}) {
  return {
    __ow_headers: { authorization: 'Bearer test-token' },
    __ow_method: 'get',
    ...overrides,
  }
}

describe('query-audit.action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 without token', async () => {
    const res = await main({ __ow_headers: {}, __ow_method: 'get' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 405 for non-GET methods', async () => {
    const res = await main({ __ow_headers: { authorization: 'Bearer x' }, __ow_method: 'put' })
    expect(res.statusCode).toBe(405)
  })

  it('returns 403 without audit scopes', async () => {
    mockValidateToken.mockResolvedValueOnce({ sub: 'u1', scopes: [], tenantId: 't1' } as never)
    const res = await main(makeParams())
    expect(res.statusCode).toBe(403)
  })

  it('returns 403 when tenant_owner queries another tenant', async () => {
    mockValidateToken.mockResolvedValueOnce({
      sub: 'u1', scopes: ['backup-audit:read:own'], tenantId: 'tenant-A',
    } as never)
    const res = await main(makeParams({ tenant_id: 'tenant-B' }))
    expect(res.statusCode).toBe(403)
  })

  it('returns 403 when tenant_owner omits tenant_id', async () => {
    mockValidateToken.mockResolvedValueOnce({
      sub: 'u1', scopes: ['backup-audit:read:own'], tenantId: 'tenant-A',
    } as never)
    const res = await main(makeParams())
    expect(res.statusCode).toBe(403)
  })

  it('returns 422 when date range exceeds max', async () => {
    mockValidateToken.mockResolvedValueOnce({
      sub: 'u1', scopes: ['backup-audit:read:global'], tenantId: 't1',
    } as never)
    const res = await main(makeParams({
      from: '2025-01-01T00:00:00Z',
      to: '2026-12-01T00:00:00Z',
    }))
    expect(res.statusCode).toBe(422)
    expect((res.body as Record<string, unknown>).error).toBe('range_too_wide')
  })

  it('returns 200 with events for admin', async () => {
    mockValidateToken.mockResolvedValueOnce({
      sub: 'u1', scopes: ['backup-audit:read:global'], tenantId: 't1',
    } as never)
    const res = await main(makeParams())
    expect(res.statusCode).toBe(200)
    expect((res.body as Record<string, unknown>).schema_version).toBe('1')
  })
})
