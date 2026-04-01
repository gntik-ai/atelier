/**
 * Integration tests for the backup audit trail API.
 * These tests verify end-to-end audit event emission and query.
 *
 * In CI, these run against a real PostgreSQL instance.
 * Locally, they may be skipped if DB_URL is not set.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const DB_URL = process.env.DB_URL
const BASE_URL = process.env.TEST_API_BASE_URL ?? 'http://localhost:3000'

const skip = !DB_URL

describe('Backup Audit API (integration)', { skip }, () => {
  it('GET /v1/backup/audit without token returns 401', async () => {
    const res = await fetch(`${BASE_URL}/v1/backup/audit`)
    assert.equal(res.status, 401)
  })

  it('PUT /v1/backup/audit/:id returns 405', async () => {
    const res = await fetch(`${BASE_URL}/v1/backup/audit/some-id`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(res.status, 405)
  })

  it('GET /v1/backup/audit with valid admin token returns 200', async () => {
    // This test requires a valid admin JWT token
    // In CI, the token is provided via TEST_ADMIN_TOKEN env var
    const token = process.env.TEST_ADMIN_TOKEN
    if (!token) return

    const res = await fetch(`${BASE_URL}/v1/backup/audit`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.schema_version, '1')
    assert.ok(Array.isArray(body.events))
    assert.ok(body.pagination)
  })

  it('GET /v1/backup/audit filtered by operation_id returns correlated events', async () => {
    const token = process.env.TEST_ADMIN_TOKEN
    if (!token) return

    const operationId = process.env.TEST_OPERATION_ID
    if (!operationId) return

    const res = await fetch(`${BASE_URL}/v1/backup/audit?operation_id=${operationId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    for (const event of body.events) {
      assert.equal(event.operation_id, operationId)
      assert.equal(event.schema_version, '1')
    }
  })

  it('tenant_owner querying another tenant returns 403', async () => {
    const token = process.env.TEST_TENANT_TOKEN
    if (!token) return

    const res = await fetch(`${BASE_URL}/v1/backup/audit?tenant_id=other-tenant`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 403)
  })
})
