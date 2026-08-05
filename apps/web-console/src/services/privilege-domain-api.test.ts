import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: vi.fn().mockResolvedValue({ denials: [], total: 0, limit: 50, offset: 0 })
}))

import { requestConsoleSessionJson } from '@/lib/console-session'
import { queryPrivilegeDomainDenials } from './privilege-domain-api'

const mock = requestConsoleSessionJson as unknown as ReturnType<typeof vi.fn>
const lastUrl = () => String(mock.mock.calls[mock.mock.calls.length - 1][0])

function parsed(url: string) {
  const [path, query = ''] = url.split('?')
  return { path, params: new URLSearchParams(query) }
}

describe('queryPrivilegeDomainDenials (C-14 authenticated canonical transport)', () => {
  beforeEach(() => {
    mock.mockClear()
    mock.mockResolvedValue({ denials: [], total: 0, limit: 50, offset: 0 })
  })

  it('goes through the authenticated console-session helper (never a bare fetch or /api URL)', async () => {
    await queryPrivilegeDomainDenials('wrk_a', { tenantId: 'ten_a' })
    expect(mock).toHaveBeenCalledTimes(1)
    expect(lastUrl().startsWith('/v1/workspaces/')).toBe(true)
    expect(lastUrl()).not.toContain('/api/')
  })

  it('addresses the canonical workspace path with the active tenant as a query scope', async () => {
    await queryPrivilegeDomainDenials('wrk_a', {
      tenantId: 'ten_a',
      requiredDomain: 'structural_admin',
      actorId: 'act_1',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-05T00:00:00.000Z',
      limit: 25,
      offset: 50
    })
    const { path, params } = parsed(lastUrl())
    expect(path).toBe('/v1/workspaces/wrk_a/privilege-domains/audit')
    expect(params.get('tenantId')).toBe('ten_a')
    expect(params.get('requiredDomain')).toBe('structural_admin')
    expect(params.get('actorId')).toBe('act_1')
    expect(params.get('from')).toBe('2026-08-01T00:00:00.000Z')
    expect(params.get('to')).toBe('2026-08-05T00:00:00.000Z')
    expect(params.get('limit')).toBe('25')
    expect(params.get('offset')).toBe('50')
    // The workspace is the path scope, never a replaceable query value.
    expect(params.has('workspaceId')).toBe(false)
  })

  it('encodes the active workspace as a single path segment', async () => {
    await queryPrivilegeDomainDenials('wrk/a', { tenantId: 'ten_a' })
    expect(parsed(lastUrl()).path).toBe('/v1/workspaces/wrk%2Fa/privilege-domains/audit')
  })

  it('omits empty/undefined filters from the query', async () => {
    await queryPrivilegeDomainDenials('wrk_a', { tenantId: 'ten_a', actorId: '', requiredDomain: undefined })
    const { params } = parsed(lastUrl())
    expect(params.has('actorId')).toBe(false)
    expect(params.has('requiredDomain')).toBe(false)
    expect(params.get('tenantId')).toBe('ten_a')
  })

  it('builds the canonical URL with no query string when called with no filters', async () => {
    await queryPrivilegeDomainDenials('wrk_a')
    expect(lastUrl()).toBe('/v1/workspaces/wrk_a/privilege-domains/audit')
  })

  it('returns the resolved denial payload from the helper', async () => {
    const payload = { denials: [{ id: 'd1' }], total: 1, limit: 50, offset: 0 }
    mock.mockResolvedValueOnce(payload)
    await expect(queryPrivilegeDomainDenials('wrk_a', { tenantId: 'ten_a' })).resolves.toEqual(payload)
  })
})
