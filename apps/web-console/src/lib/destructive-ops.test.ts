import { afterEach, describe, expect, it, vi } from 'vitest'

import { DESTRUCTIVE_OP_LEVELS, fetchCascadeImpact } from './destructive-ops'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('destructive-ops', () => {
  it('mapea dependents a un resumen de impacto', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        dependents: [
          { resourceType: 'workspace', count: 3 },
          { resourceType: 'database', count: 1 }
        ]
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchCascadeImpact('tenant', 'ten_1')).resolves.toEqual([
      { resourceType: 'workspace', count: 3 },
      { resourceType: 'database', count: 1 }
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      '/admin/v1/tenant/ten_1/cascade-impact',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('propaga errores 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 404, code: 'HTTP_404', message: 'Missing resource' })
    }))

    await expect(fetchCascadeImpact('workspace', 'wrk_missing')).rejects.toMatchObject({
      status: 404,
      message: 'Missing resource'
    })
  })

  it('propaga errores 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 500, code: 'HTTP_500', message: 'Backend exploded' })
    }))

    await expect(fetchCascadeImpact('database', 'db_1')).rejects.toMatchObject({
      status: 500,
      message: 'Backend exploded'
    })
  })

  it('expone exactamente las operaciones destructivas visibles del repo', () => {
    expect(DESTRUCTIVE_OP_LEVELS).toEqual({
      'soft-delete-application': 'WARNING',
      'detach-provider': 'WARNING',
      'revoke-service-account-credential': 'WARNING'
    })
  })
})
