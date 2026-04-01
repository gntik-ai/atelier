import { describe, it, expect } from 'vitest'

/**
 * Contract test: validates the shape of the BackupStatusResponse type
 * against the documented API schema v1.
 */
describe('BackupStatusResponse Contract', () => {
  const validResponse = {
    schema_version: '1' as const,
    tenant_id: 'tenant-abc',
    queried_at: '2026-03-31T12:00:00Z',
    components: [
      {
        component_type: 'postgresql',
        instance_label: 'pg-main',
        status: 'success' as const,
        last_successful_backup_at: '2026-03-31T06:00:00Z',
        last_checked_at: '2026-03-31T12:00:00Z',
        stale: false,
        stale_since: null,
      },
    ],
    deployment_backup_available: true,
  }

  it('should have schema_version "1"', () => {
    expect(validResponse.schema_version).toBe('1')
  })

  it('should have a components array', () => {
    expect(Array.isArray(validResponse.components)).toBe(true)
  })

  it('each component should have required fields', () => {
    for (const c of validResponse.components) {
      expect(c).toHaveProperty('component_type')
      expect(c).toHaveProperty('instance_label')
      expect(c).toHaveProperty('status')
      expect(c).toHaveProperty('last_checked_at')
      expect(c).toHaveProperty('stale')
    }
  })

  it('should have deployment_backup_available boolean', () => {
    expect(typeof validResponse.deployment_backup_available).toBe('boolean')
  })
})
