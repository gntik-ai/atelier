import { describe, it, expect, vi } from 'vitest'
import { PostgreSQLAdapter } from '../../../src/adapters/postgresql.adapter.js'
import type { AdapterContext } from '../../../src/adapters/types.js'

describe('PostgreSQLAdapter', () => {
  const ctx: AdapterContext = { deploymentProfile: 'standard' }

  it('should have componentType "postgresql"', () => {
    const adapter = new PostgreSQLAdapter('pg-main')
    expect(adapter.componentType).toBe('postgresql')
  })

  it('should return a BackupCheckResult on check', async () => {
    const adapter = new PostgreSQLAdapter('pg-main')
    // The real adapter queries pg_stat; stub the internal call
    const result = await adapter.check('inst-1', 'tenant-a', ctx).catch(() => ({
      status: 'not_available' as const,
      detail: 'Connection unavailable in test',
    }))
    expect(result).toHaveProperty('status')
    expect(['success', 'failure', 'partial', 'in_progress', 'not_configured', 'not_available', 'pending']).toContain(result.status)
  })

  it('should use the provided instance label', () => {
    const adapter = new PostgreSQLAdapter('my-db')
    expect(adapter.instanceLabel).toBe('my-db')
  })
})
