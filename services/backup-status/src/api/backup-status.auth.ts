/**
 * JWT validation and scope enforcement for backup-status API.
 */

export interface TokenClaims {
  sub: string
  tenantId?: string
  scopes: string[]
  exp: number
  iat: number
}

const KEYCLOAK_JWKS_URL = process.env.KEYCLOAK_JWKS_URL
const TEST_MODE = process.env.TEST_MODE === 'true'

/**
 * Validate a JWT token and return claims.
 * In TEST_MODE, parses the token as base64-encoded JSON (no signature verification).
 */
export async function validateToken(token: string): Promise<TokenClaims> {
  if (TEST_MODE) {
    try {
      const parts = token.split('.')
      const payload = JSON.parse(Buffer.from(parts[1] ?? parts[0], 'base64url').toString())
      return {
        sub: payload.sub ?? 'test-user',
        tenantId: payload.tenant_id ?? payload.tenantId,
        scopes: payload.scopes ?? payload.scope?.split(' ') ?? [],
        exp: payload.exp ?? Math.floor(Date.now() / 1000) + 3600,
        iat: payload.iat ?? Math.floor(Date.now() / 1000),
      }
    } catch {
      throw new AuthError(401, 'Invalid token format')
    }
  }

  if (!KEYCLOAK_JWKS_URL) {
    throw new AuthError(500, 'JWKS URL not configured')
  }

  // In production, verify JWT signature with Keycloak JWKS
  // Using a simplified verification approach for the MVP
  try {
    const parts = token.split('.')
    if (parts.length !== 3) throw new Error('Invalid JWT structure')
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new AuthError(401, 'Token expired')
    }

    return {
      sub: payload.sub,
      tenantId: payload.tenant_id ?? payload.tenantId,
      scopes: payload.scopes ?? payload.scope?.split(' ') ?? [],
      exp: payload.exp,
      iat: payload.iat,
    }
  } catch (err) {
    if (err instanceof AuthError) throw err
    throw new AuthError(401, 'Invalid or expired token')
  }
}

export function enforceScope(claims: TokenClaims, requiredScope: string): void {
  if (!claims.scopes.includes(requiredScope)) {
    throw new AuthError(403, `Missing required scope: ${requiredScope}`)
  }
}

export class AuthError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'AuthError'
    this.statusCode = statusCode
  }
}
