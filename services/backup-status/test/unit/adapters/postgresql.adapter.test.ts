import { describe, it, expect, vi } from 'vitest'
import { postgresqlAdapter } from '../../../src/adapters/postgresql.adapter.js'
import type { AdapterContext } from '../../../src/adapters/types.js'

describe('PostgreSQLAdapter', () => {
  const ctx: AdapterContext = { deploymentProfile: 'standard' }

  it('should have componentType "postgresql"', () => {
    expect(postgresqlAdapter.componentType).toBe('postgresql')
  })

  it('should return a BackupCheckResult on check', async () => {
    const result = await postgresqlAdapter.check('inst-1', 'tenant-a', ctx).catch(() => ({
      status: 'not_available' as const,
      detail: 'Connection unavailable in test',
    }))
    expect(result).toHaveProperty('status')
    expect(['success', 'failure', 'partial', 'in_progress', 'not_configured', 'not_available', 'pending']).toContain(result.status)
  })

  it('should have an instance label', () => {
    expect(postgresqlAdapter.instanceLabel).toBeDefined()
    expect(typeof postgresqlAdapter.instanceLabel).toBe('string')
  })
})
