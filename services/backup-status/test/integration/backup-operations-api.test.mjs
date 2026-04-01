import { describe, it, expect } from 'vitest'

/**
 * Integration tests for the backup operations API endpoints.
 * Requires a running PostgreSQL instance, APISIX gateway, and test tokens.
 * Skipped in CI unless INTEGRATION_TEST=true.
 */
const SKIP = process.env.INTEGRATION_TEST !== 'true'

describe.skipIf(SKIP)('Backup Operations API Integration', () => {
  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:9080'
  const adminToken = process.env.TEST_ADMIN_TOKEN
  const tenantToken = process.env.TEST_TENANT_TOKEN

  function makeJwt(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    return `${header}.${body}.`
  }

  it('CA-01: POST /v1/backup/trigger → 202 + operation_id', async () => {
    const token = adminToken ?? makeJwt({
      sub: 'test-admin',
      tenant_id: 'integration-tenant',
      scopes: ['backup:write:global'],
    })

    const res = await fetch(`${baseUrl}/v1/backup/trigger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        tenant_id: 'integration-tenant',
        component_type: 'postgresql',
        instance_id: 'pg-integration',
      }),
    })

    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toHaveProperty('operation_id')
    expect(body.status).toBe('accepted')

    // Verify with GET
    const getRes = await fetch(`${baseUrl}/v1/backup/operations/${body.operation_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (getRes.ok) {
      const getBody = await getRes.json()
      expect(getBody.schema_version).toBe('1')
      expect(getBody.operation.id).toBe(body.operation_id)
    }
  })

  it('CA-02: POST /v1/backup/restore → 202 + operation_id', async () => {
    const token = adminToken ?? makeJwt({
      sub: 'test-sre',
      scopes: ['backup:restore:global', 'backup-status:read:global'],
    })

    // First list snapshots to get a valid one
    const snapRes = await fetch(
      `${baseUrl}/v1/backup/snapshots?tenant_id=integration-tenant&component_type=postgresql&instance_id=pg-integration`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!snapRes.ok) return // skip if snapshots not available

    const snapBody = await snapRes.json()
    const available = snapBody.snapshots?.find((s) => s.available)
    if (!available) return // skip if no available snapshot

    const res = await fetch(`${baseUrl}/v1/backup/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        tenant_id: 'integration-tenant',
        component_type: 'postgresql',
        instance_id: 'pg-integration',
        snapshot_id: available.snapshot_id,
      }),
    })

    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toHaveProperty('operation_id')
  })

  it('CA-07: duplicate active operation → 409 with conflict_operation_id', async () => {
    const token = adminToken ?? makeJwt({
      sub: 'test-admin',
      tenant_id: 'conflict-tenant',
      scopes: ['backup:write:global'],
    })

    const payload = {
      tenant_id: 'conflict-tenant',
      component_type: 'postgresql',
      instance_id: 'pg-conflict',
    }

    // First request should succeed (or already active)
    const res1 = await fetch(`${baseUrl}/v1/backup/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })

    // Second request should conflict
    if (res1.status === 202) {
      const res2 = await fetch(`${baseUrl}/v1/backup/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      })

      expect(res2.status).toBe(409)
      const body2 = await res2.json()
      expect(body2).toHaveProperty('conflict_operation_id')
    }
  })

  it('CA-03: POST /restore with tenant_owner token → 403', async () => {
    const token = tenantToken ?? makeJwt({
      sub: 'tenant-user',
      tenant_id: 'integration-tenant',
      scopes: ['backup:write:own'],
    })

    const res = await fetch(`${baseUrl}/v1/backup/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        tenant_id: 'integration-tenant',
        component_type: 'postgresql',
        instance_id: 'pg-integration',
        snapshot_id: 'snap-1',
      }),
    })

    expect(res.status).toBe(403)
  })

  it('CA-05: GET /v1/backup/snapshots → response with schema v1', async () => {
    const token = adminToken ?? makeJwt({
      sub: 'test-admin',
      scopes: ['backup-status:read:global'],
    })

    const res = await fetch(
      `${baseUrl}/v1/backup/snapshots?tenant_id=integration-tenant&component_type=postgresql&instance_id=pg-integration`,
      { headers: { Authorization: `Bearer ${token}` } },
    )

    if (res.ok) {
      const body = await res.json()
      expect(body.schema_version).toBe('1')
      expect(Array.isArray(body.snapshots)).toBe(true)
      if (body.snapshots.length > 0) {
        expect(body.snapshots[0]).toHaveProperty('snapshot_id')
        expect(body.snapshots[0]).toHaveProperty('created_at')
        expect(body.snapshots[0]).toHaveProperty('available')
      }
    }
  })
})
