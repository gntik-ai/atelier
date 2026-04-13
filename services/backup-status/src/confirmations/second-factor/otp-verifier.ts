import { normalizeServiceBaseUrl } from '../../shared/network.js'

export interface OtpVerificationResult {
  valid: boolean
  error?: 'otp_invalid' | 'keycloak_unavailable' | 'mfa_not_enabled'
}

export async function verifyOtp(
  otpCode: string,
  requesterId: string,
  keycloakOtpVerifyUrl: string,
  mfaEnabled: boolean,
): Promise<OtpVerificationResult> {
  if (!mfaEnabled) {
    return { valid: false, error: 'mfa_not_enabled' }
  }

  if (!keycloakOtpVerifyUrl) {
    return { valid: false, error: 'keycloak_unavailable' }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)

  try {
    const normalizedUrl = normalizeServiceBaseUrl(keycloakOtpVerifyUrl, 'keycloakOtpVerifyUrl', {
      allowBareInternalHttp: true,
    })
    const response = await fetch(normalizedUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp_code: otpCode, requester_id: requesterId }),
      signal: controller.signal,
    })

    if (!response.ok) {
      return { valid: false, error: response.status === 401 || response.status === 422 ? 'otp_invalid' : 'keycloak_unavailable' }
    }

    const payload = await response.json().catch(() => ({} as Record<string, unknown>))
    if (payload?.valid === false) {
      return { valid: false, error: 'otp_invalid' }
    }
    if (payload?.valid === true || response.status === 204) {
      return { valid: true }
    }
    return { valid: false, error: 'otp_invalid' }
  } catch {
    return { valid: false, error: 'keycloak_unavailable' }
  } finally {
    clearTimeout(timeout)
  }
}
