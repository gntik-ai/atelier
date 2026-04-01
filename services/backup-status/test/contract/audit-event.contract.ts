import { describe, it, expect } from 'vitest'
import type { AuditEventAdmin, AuditEventPublic } from '../../src/audit/audit-trail.types.js'

const sampleAdmin: AuditEventAdmin = {
  schema_version: '1',
  id: 'e7a3f291-0ab4-4c1e-b923-1d2e5f6a7b8c',
  event_type: 'restore.requested',
  correlation_id: 'd1e2f3a4-0000-0000-0000-000000000000',
  operation_id: 'b3a7f2e1-0000-0000-0000-000000000000',
  tenant_id: 'tenant-abc',
  component_type: 'postgresql',
  instance_id: 'pg-cluster-12',
  snapshot_id: 'snap-20260401-180000',
  actor_id: 'user-sre-01',
  actor_role: 'sre',
  session_id: 'sess-xyz-789',
  source_ip: '192.168.1.100',
  user_agent: 'Mozilla/5.0',
  session_context_status: 'full',
  result: 'accepted',
  rejection_reason: null,
  rejection_reason_public: null,
  detail: null,
  detail_truncated: false,
  destructive: true,
  occurred_at: '2026-04-01T10:00:00.000Z',
}

const samplePublic: AuditEventPublic = {
  schema_version: '1',
  id: 'e7a3f291-0ab4-4c1e-b923-1d2e5f6a7b8c',
  event_type: 'restore.requested',
  correlation_id: 'd1e2f3a4-0000-0000-0000-000000000000',
  operation_id: 'b3a7f2e1-0000-0000-0000-000000000000',
  tenant_id: 'tenant-abc',
  component_type: 'postgresql',
  result: 'accepted',
  rejection_reason_public: null,
  destructive: true,
  occurred_at: '2026-04-01T10:00:00.000Z',
}

describe('Audit Event Contract', () => {
  describe('Admin event', () => {
    it('has schema_version "1" (string, not number)', () => {
      expect(sampleAdmin.schema_version).toBe('1')
      expect(typeof sampleAdmin.schema_version).toBe('string')
    })

    it('includes all required fields', () => {
      const requiredFields = [
        'schema_version', 'id', 'event_type', 'correlation_id', 'operation_id',
        'tenant_id', 'component_type', 'instance_id', 'snapshot_id',
        'actor_id', 'actor_role',
        'session_id', 'source_ip', 'user_agent', 'session_context_status',
        'result', 'rejection_reason', 'rejection_reason_public',
        'detail', 'detail_truncated', 'destructive', 'occurred_at',
      ]
      for (const field of requiredFields) {
        expect(sampleAdmin).toHaveProperty(field)
      }
    })

    it('does NOT include publication state fields', () => {
      const obj = sampleAdmin as Record<string, unknown>
      expect(obj).not.toHaveProperty('published_at')
      expect(obj).not.toHaveProperty('publish_attempts')
      expect(obj).not.toHaveProperty('publish_last_error')
    })
  })

  describe('Public event (tenant owner)', () => {
    it('has schema_version "1"', () => {
      expect(samplePublic.schema_version).toBe('1')
    })

    it('does NOT contain sensitive fields', () => {
      const obj = samplePublic as Record<string, unknown>
      expect(obj).not.toHaveProperty('session_id')
      expect(obj).not.toHaveProperty('source_ip')
      expect(obj).not.toHaveProperty('user_agent')
      expect(obj).not.toHaveProperty('session_context_status')
      expect(obj).not.toHaveProperty('rejection_reason')
      expect(obj).not.toHaveProperty('detail')
      expect(obj).not.toHaveProperty('detail_truncated')
      expect(obj).not.toHaveProperty('instance_id')
      expect(obj).not.toHaveProperty('snapshot_id')
    })
  })
})
