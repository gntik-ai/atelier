import { afterEach, describe, expect, it, vi } from 'vitest'

import { requestJson } from './http'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestJson canonical error compatibility', () => {
  it('keeps the GW_ wire code while exposing the legacy domain code to console callers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 422,
      code: 'GW_FLOW_DEFINITION_INVALID',
      message: 'definition is invalid',
      detail: {
        reason: 'FLOW_DEFINITION_INVALID',
        errors: [{ code: 'FLW-E001', nodeId: 'node-1', message: 'node is invalid' }]
      },
      requestId: 'request-console-001',
      correlationId: 'correlation-console-001',
      timestamp: '2026-08-05T00:00:00.000Z',
      resource: { path: '/v1/flows/workspaces/ws/flows' }
    }), { status: 422, headers: { 'content-type': 'application/json' } })))

    await expect(requestJson('/v1/flows/workspaces/ws/flows')).rejects.toMatchObject({
      status: 422,
      code: 'FLOW_DEFINITION_INVALID',
      gatewayCode: 'GW_FLOW_DEFINITION_INVALID',
      errors: [{ code: 'FLW-E001', nodeId: 'node-1', message: 'node is invalid' }],
      requestId: 'request-console-001',
      correlationId: 'correlation-console-001'
    })
  })

  it('continues to accept the legacy error body during a rolling rollback window', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'FORBIDDEN', message: 'forbidden'
    }), { status: 403, headers: { 'content-type': 'application/json' } })))

    await expect(requestJson('/v1/legacy')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      gatewayCode: undefined
    })
  })
})
