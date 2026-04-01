import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn().mockResolvedValue({ rows: [] })

vi.mock('../../../src/audit/audit-trail.repository.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/audit/audit-trail.repository.js')>()
  return mod
})

import { AuditTrailRepository, setPool } from '../../../src/audit/audit-trail.repository.js'
import type { AuditEvent } from '../../../src/audit/audit-trail.types.js'

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'evt-1',
    schemaVersion: '1',
    eventType: 'backup.requested',
    operationId: 'op-1',
    correlationId: 'corr-1',
    tenantId: 'tenant-1',
    componentType: 'postgresql',
    instanceId: 'pg-1',
    actorId: 'user-1',
    actorRole: 'sre',
    sessionContext: { status: 'not_applicable' },
    result: 'accepted',
    detail: null,
    detailTruncated: false,
    destructive: false,
    occurredAt: new Date('2026-04-01T10:00:00Z'),
    publishedAt: null,
    publishAttempts: 0,
    ...overrides,
  }
}

describe('AuditTrailRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setPool({ query: mockQuery } as never)
  })

  it('insert() calls DB with all fields', async () => {
    await AuditTrailRepository.insert(makeEvent())
    expect(mockQuery).toHaveBeenCalledOnce()
    const [sql, values] = mockQuery.mock.calls[0]
    expect(sql).toContain('INSERT INTO backup_audit_events')
    expect(values).toHaveLength(24)
  })

  it('markPublished() updates published_at', async () => {
    await AuditTrailRepository.markPublished('evt-1')
    expect(mockQuery).toHaveBeenCalledOnce()
    const [sql] = mockQuery.mock.calls[0]
    expect(sql).toContain('published_at = NOW()')
  })

  it('incrementPublishAttempt() increments counter and sets error', async () => {
    await AuditTrailRepository.incrementPublishAttempt('evt-1', 'connection refused')
    const [sql, values] = mockQuery.mock.calls[0]
    expect(sql).toContain('publish_attempts = publish_attempts + 1')
    expect(values).toContain('connection refused')
  })

  it('findPendingPublish() queries with maxAttempts filter', async () => {
    await AuditTrailRepository.findPendingPublish(5)
    const [sql, values] = mockQuery.mock.calls[0]
    expect(sql).toContain('published_at IS NULL')
    expect(sql).toContain('publish_attempts < $1')
    expect(values).toEqual([5])
  })

  it('query() enforces max limit of 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await AuditTrailRepository.query({ limit: 500 })
    const [, values] = mockQuery.mock.calls[0]
    // Last value is limit + 1 = 201
    expect(values[values.length - 1]).toBe(201)
  })

  it('query() applies tenant filter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await AuditTrailRepository.query({ tenantId: 'tenant-1' })
    const [sql, values] = mockQuery.mock.calls[0]
    expect(sql).toContain('tenant_id = $1')
    expect(values[0]).toBe('tenant-1')
  })
})
