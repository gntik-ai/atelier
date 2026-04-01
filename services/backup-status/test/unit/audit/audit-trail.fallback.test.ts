import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFindPending = vi.fn().mockResolvedValue([])
const mockMarkPublished = vi.fn().mockResolvedValue(undefined)
const mockIncrementAttempt = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../src/audit/audit-trail.repository.js', () => ({
  AuditTrailRepository: {
    findPendingPublish: (...args: unknown[]) => mockFindPending(...args),
    markPublished: (...args: unknown[]) => mockMarkPublished(...args),
    incrementPublishAttempt: (...args: unknown[]) => mockIncrementAttempt(...args),
  },
}))

import { retryPendingAuditEvents } from '../../../src/audit/audit-trail.fallback.js'

function makePendingEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    schemaVersion: '1' as const,
    eventType: 'backup.requested' as const,
    tenantId: 'tenant-1',
    componentType: 'postgresql',
    instanceId: 'pg-1',
    actorId: 'user-1',
    actorRole: 'sre',
    sessionContext: { status: 'not_applicable' as const },
    result: 'accepted',
    detail: null,
    detailTruncated: false,
    destructive: false,
    occurredAt: new Date(),
    publishedAt: null,
    publishAttempts: 0,
    correlationId: 'corr-1',
    ...overrides,
  }
}

describe('retryPendingAuditEvents()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // No KAFKA_BROKERS → publishToKafka will throw
    delete process.env.KAFKA_BROKERS
  })

  it('queries for pending events', async () => {
    await retryPendingAuditEvents()
    expect(mockFindPending).toHaveBeenCalledOnce()
  })

  it('increments publish attempt on failure', async () => {
    mockFindPending.mockResolvedValueOnce([makePendingEvent()])
    await retryPendingAuditEvents()
    expect(mockIncrementAttempt).toHaveBeenCalledOnce()
  })

  it('does not throw even if everything fails', async () => {
    mockFindPending.mockRejectedValueOnce(new Error('DB down'))
    await expect(retryPendingAuditEvents()).resolves.toBeUndefined()
  })

  it('emits alert when max attempts reached', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFindPending.mockResolvedValueOnce([makePendingEvent({ publishAttempts: 4 })])
    await retryPendingAuditEvents()
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('max publish attempts reached'),
      expect.any(String),
    )
    consoleSpy.mockRestore()
  })
})
