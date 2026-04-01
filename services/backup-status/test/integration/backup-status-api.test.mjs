import { describe, it, expect } from 'vitest'

/**
 * Integration test for the backup-status API endpoint.
 * Requires a running PostgreSQL instance and APISIX gateway.
 * Skipped in CI unless INTEGRATION_TEST=true.
 */
const SKIP = process.env.INTEGRATION_TEST !== 'true'

describe.skipIf(SKIP)('Backup Status API Integration', () => {
  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:9080'

  it('should return 401 without a token', async () => {
    const res = await fetch(`${baseUrl}/v1/backup/status`)
    expect(res.status).toBe(401)
  })

  it('should return 200 with a valid admin token', async () => {
    const token = process.env.TEST_ADMIN_TOKEN
    if (!token) return // skip if no token provided

    const res = await fetch(`${baseUrl}/v1/backup/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('schema_version', '1')
    expect(body).toHaveProperty('components')
    expect(Array.isArray(body.components)).toBe(true)
  })
})
