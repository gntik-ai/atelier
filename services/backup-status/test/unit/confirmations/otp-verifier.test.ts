import { describe, expect, it, vi, afterEach } from 'vitest'
import { verifyOtp } from '../../../src/confirmations/second-factor/otp-verifier.js'

describe('otp-verifier', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns keycloak_unavailable for malformed verification URLs', async () => {
    const result = await verifyOtp('123456', 'req-1', 'ftp://example.com/otp', true)
    expect(result).toEqual({ valid: false, error: 'keycloak_unavailable' })
  })

  it('posts to a normalized verification URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => ({ valid: true }),
    } as Response)

    const result = await verifyOtp('123456', 'req-1', 'http://keycloak:8080/otp/verify/', true)

    expect(result).toEqual({ valid: true })
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://keycloak:8080/otp/verify',
      expect.objectContaining({ method: 'POST' })
    )
  })
})
