import { afterEach, describe, expect, it, vi } from 'vitest'

import { publicApiFetch, requestJson } from './http'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestJson canonical error compatibility', () => {
  it('applies trace headers to raw public transports without replacing caller headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await publicApiFetch('/v1/events/topics/topic-1/stream', {
      headers: { Authorization: 'Bearer token', 'X-Correlation-Id': 'corr-raw-client-001' }
    })

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('authorization')).toBe('Bearer token')
    expect(headers.get('x-api-version')).toBe('2026-03-26')
    expect(headers.get('x-correlation-id')).toBe('corr-raw-client-001')
  })

  it('sends the current trace headers and surfaces the returned correlation metadata', async () => {
    const onResponse = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-response-001' }
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestJson('/v1/platform/route-catalog', { onResponse })).resolves.toEqual({ ok: true })
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('x-api-version')).toBe('2026-03-26')
    expect(headers.get('x-correlation-id')).toMatch(/^[A-Za-z0-9._:-]{8,128}$/)
    expect(onResponse).toHaveBeenCalledWith({ correlationId: 'corr-response-001' })
  })

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
