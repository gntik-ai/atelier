import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock repository
const mockInsert = vi.fn().mockResolvedValue(undefined)
const mockMarkPublished = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../src/audit/audit-trail.repository.js', () => ({
  AuditTrailRepository: {
    insert: (...args: unknown[]) => mockInsert(...args),
    markPublished: (...args: unknown[]) => mockMarkPublished(...args),
  },
}))

import { emitAuditEvent } from '../../../src/audit/audit-trail.js'
import type { AuditEventInput } from '../../../src/audit/audit-trail.types.js'

function makeInput(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    eventType: 'backup.requested',
    tenantId: 'tenant-1',
    componentType: 'postgresql',
    instanceId: 'pg-1',
    actorId: 'user-1',
    actorRole: 'sre',
    sessionContext: { status: 'not_applicable' },
    result: 'accepted',
    ...overrides,
  }
}

describe('emitAuditEvent()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists event in DB before Kafka publish', async () => {
    await emitAuditEvent(makeInput())
    expect(mockInsert).toHaveBeenCalledOnce()
    const event = mockInsert.mock.calls[0][0]
    expect(event.schemaVersion).toBe('1')
    expect(event.id).toBeDefined()
    expect(event.occurredAt).toBeInstanceOf(Date)
  })

  it('does NOT throw when DB insert fails', async () => {
    mockInsert.mockRejectedValueOnce(new Error('DB down'))
    await expect(emitAuditEvent(makeInput())).resolves.toBeUndefined()
  })

  it('truncates detail when it exceeds MAX_DETAIL_BYTES', async () => {
    const longDetail = 'x'.repeat(8000)
    await emitAuditEvent(makeInput({ detail: longDetail }))
    const event = mockInsert.mock.calls[0][0]
    expect(event.detailTruncated).toBe(true)
    expect(Buffer.byteLength(event.detail, 'utf8')).toBeLessThanOrEqual(4096)
  })

  it('sets detailTruncated = false when detail is short', async () => {
    await emitAuditEvent(makeInput({ detail: 'short' }))
    const event = mockInsert.mock.calls[0][0]
    expect(event.detailTruncated).toBe(false)
  })

  it('auto-generates correlationId when not provided', async () => {
    await emitAuditEvent(makeInput())
    const event = mockInsert.mock.calls[0][0]
    expect(event.correlationId).toBeDefined()
    expect(typeof event.correlationId).toBe('string')
  })

  it('defaults destructive to false', async () => {
    await emitAuditEvent(makeInput())
    const event = mockInsert.mock.calls[0][0]
    expect(event.destructive).toBe(false)
  })

  it('sets session_context_status from input', async () => {
    await emitAuditEvent(makeInput({
      sessionContext: { status: 'full', sessionId: 'sess-1', sourceIp: '1.2.3.4' },
    }))
    const event = mockInsert.mock.calls[0][0]
    expect(event.sessionContext.status).toBe('full')
  })
})
