import { createPublicKey } from 'node:crypto';
import { decodeProtectedHeader, jwtVerify } from 'jose';
import jwksClient from 'jwks-rsa';
import { loadEnv } from '../config/env.mjs';

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

function extractToken(bearerToken) {
  if (typeof bearerToken !== 'string' || bearerToken.trim() === '') {
    throw new AuthError('TOKEN_INVALID', 'Bearer token is required.');
  }

  if (!bearerToken.startsWith('Bearer ')) {
    return bearerToken.trim();
  }

  return bearerToken.slice('Bearer '.length).trim();
}

function normalizeScopes(payload) {
  if (Array.isArray(payload.scopes)) {
    return payload.scopes;
  }

  if (typeof payload.scope === 'string') {
    return payload.scope.split(/\s+/).filter(Boolean);
  }

  return [];
}

function normalizeWorkspaces(payload) {
  if (Array.isArray(payload.workspace_ids)) {
    return payload.workspace_ids;
  }

  if (Array.isArray(payload.workspaces)) {
    return payload.workspaces.map((workspace) => {
      if (typeof workspace === 'string') {
        return workspace;
      }

      return workspace?.workspaceId ?? workspace?.id;
    }).filter(Boolean);
  }

  if (payload.workspace_access && typeof payload.workspace_access === 'object') {
    return Object.keys(payload.workspace_access);
  }

  if (typeof payload.workspace_id === 'string') {
    return [payload.workspace_id];
  }

  return [];
}

function normalizeClaims(payload) {
  return {
    ...payload,
    sub: payload.sub,
    tenant_id: payload.tenant_id,
    scopes: normalizeScopes(payload),
    authorizedWorkspaces: normalizeWorkspaces(payload),
    exp: payload.exp,
    jti: payload.jti
  };
}

function isUnknownKidError(error) {
  return error?.code === 'ERR_JWKS_NO_MATCHING_KEY'
    || error?.name === 'SigningKeyNotFoundError'
    || /signing key/i.test(error?.message ?? '')
    || /no matching key/i.test(error?.message ?? '');
}

function toAuthError(error) {
  if (error instanceof AuthError) {
    return error;
  }

  if (error?.code === 'ERR_JWT_EXPIRED' || error?.name === 'JWTExpired') {
    return new AuthError('TOKEN_EXPIRED', 'Token has expired.');
  }

  return new AuthError('TOKEN_INVALID', error?.message ?? 'Token validation failed.');
}

export function createTokenValidator({
  envProvider = loadEnv,
  jwksClientFactory = jwksClient,
  jwtVerifyFn = jwtVerify,
  decodeHeaderFn = decodeProtectedHeader,
  fetchFn = fetch,
  createPublicKeyFn = createPublicKey,
  logger = console
} = {}) {
  const keyCache = new Map();

  async function fetchSigningKey(env, kid, forceRefresh = false) {
    const now = Date.now();
    const ttlMs = env.JWKS_CACHE_TTL_SECONDS * 1000;
    const cached = keyCache.get(kid);

    if (cached && cached.expiresAt > now && !forceRefresh) {
      return cached.publicKey;
    }

    const client = jwksClientFactory({
      jwksUri: env.KEYCLOAK_JWKS_URL,
      cache: !forceRefresh,
      cacheMaxAge: ttlMs
    });

    const signingKey = await client.getSigningKey(kid);
    const publicKey = createPublicKeyFn(signingKey.getPublicKey());
    keyCache.set(kid, { publicKey, expiresAt: now + ttlMs });
    return publicKey;
  }

  async function introspectToken(env, token) {
    const body = new URLSearchParams({ token, client_id: env.KEYCLOAK_INTROSPECTION_CLIENT_ID });
    const auth = Buffer.from(`${env.KEYCLOAK_INTROSPECTION_CLIENT_ID}:${env.KEYCLOAK_INTROSPECTION_CLIENT_SECRET}`).toString('base64');

    const response = await fetchFn(env.KEYCLOAK_INTROSPECTION_URL, {
      method: 'POST',
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body
    });

    if (!response.ok) {
      throw new AuthError('TOKEN_INVALID', `Token introspection failed with status ${response.status}.`);
    }

    const payload = await response.json();

    if (!payload.active) {
      throw new AuthError('TOKEN_REVOKED', 'Token is inactive or revoked.');
    }

    return normalizeClaims(payload);
  }

  async function verifyLocally(token, env, forceRefresh = false) {
    const header = decodeHeaderFn(token);

    if (!header?.kid) {
      throw new AuthError('TOKEN_INVALID', 'JWT header is missing kid.');
    }

    const key = await fetchSigningKey(env, header.kid, forceRefresh);
    const { payload } = await jwtVerifyFn(token, key, { clockTolerance: '5 seconds' });
    return normalizeClaims(payload);
  }

  return async function validateToken(bearerToken) {
    const env = envProvider();
    const token = extractToken(bearerToken);

    try {
      return await verifyLocally(token, env, false);
    } catch (error) {
      if (isUnknownKidError(error)) {
        try {
          return await verifyLocally(token, env, true);
        } catch (refreshError) {
          if (!isUnknownKidError(refreshError)) {
            throw toAuthError(refreshError);
          }

          logger.warn?.('JWT signing key not found after refresh, falling back to introspection.');
          return introspectToken(env, token);
        }
      }

      throw toAuthError(error);
    }
  };
}

export const validateToken = createTokenValidator();
