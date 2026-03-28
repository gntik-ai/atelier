import { createHash } from 'node:crypto';

import {
  STORAGE_POLICY_ACTIONS,
  STORAGE_POLICY_PRINCIPAL_TYPES
} from './storage-access-policy.mjs';

const DEFAULT_NOW = '2026-03-28T00:00:00Z';
const DEFAULT_TTL_SECONDS = 3600;
const DEFAULT_MAX_TTL_SECONDS = 60 * 60 * 24 * 30;

function hashSeed(seed, length = 16) {
  return createHash('sha256').update(String(seed)).digest('hex').slice(0, length);
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} is required.`);
  }

  return value.trim();
}

function toIso(value = DEFAULT_NOW) {
  return new Date(value).toISOString();
}

function unique(items = []) {
  return [...new Set(items)];
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return String(value).trim();
}

function normalizeCredentialType(value) {
  const credentialType = String(value ?? STORAGE_PROGRAMMATIC_CREDENTIAL_TYPES.ACCESS_KEY).trim().toLowerCase();
  if (!Object.values(STORAGE_PROGRAMMATIC_CREDENTIAL_TYPES).includes(credentialType)) {
    throw new Error(STORAGE_PROGRAMMATIC_CREDENTIAL_ERROR_CODES.INVALID_CREDENTIAL_TYPE);
  }

  return credentialType;
}

function normalizeState(value) {
  const state = String(value ?? STORAGE_PROGRAMMATIC_CREDENTIAL_STATES.ACTIVE).trim().toLowerCase();
  if (!Object.values(STORAGE_PROGRAMMATIC_CREDENTIAL_STATES).includes(state)) {
    throw new Error(STORAGE_PROGRAMMATIC_CREDENTIAL_ERROR_CODES.INVALID_STATE);
  }

  return state;
}

function normalizePrincipal(input = {}) {
  const principalType = String(input.principalType ?? input.type ?? '').trim().toLowerCase();
  const principalId = assertNonEmptyString(input.principalId ?? input.id, 'principalId');

  if (![STORAGE_POLICY_PRINCIPAL_TYPES.USER, STORAGE_POLICY_PRINCIPAL_TYPES.SERVICE_ACCOUNT].includes(principalType)) {
    throw new Error(STORAGE_PROGRAMMATIC_CREDENTIAL_ERROR_CODES.INVALID_PRINCIPAL_TYPE);
  }

  return {
    principalType,
    principalId,
    displayName: normalizeOptionalString(input.displayName) ?? principalId
  };
}

function normalizeAllowedActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error(STORAGE_PROGRAMMATIC_CREDENTIAL_ERROR_CODES.INVALID_SCOPE);
  }

  const normalized = unique(actions.map((action) => assertNonEmptyString(action, 'allowedActions[]')));
  if (normalized.some((action) => !STORAGE_PROGRAMMATIC_CREDENTIAL_ALLOWED_ACTIONS.includes(action))) {
    throw new Error(STORAGE_PROGRAMMATIC_CREDENTIAL_ERROR_CODES.INVALID_OPERATION);
  }

  return normalized;
}

function normalizeScope(scope = {}, workspaceId) {
  const scopeWorkspaceId = normalizeOptionalString(scope.workspaceId) ?? workspaceId;
  if (scopeWorkspaceId !== workspaceId) {
    throw new Error(STORAGE_PROGRAMMATIC_CREDENTIAL_ERROR_CODES.SCOPE_OUTSIDE_WORKSPACE);
  }

  const normalized = {
    workspaceId: scopeWorkspaceId,
    allowedActions: normalizeAllowedActions(scope.allowedActions)
  };

  const bucketId = normalizeOptionalString(scope.bucketId);
  const bucketName = normalizeOptionalString(scope.bucketName);
  const objectPrefix = normalizeOptionalString(scope.objectPrefix)?.replace(/^\/+/, '');

  if (bucketId) {
    normalized.bucketId = bucketId;
  }

  if (bucketName) {
    normalized.bucketName = bucketName;
  }

  if (objectPrefix) {
    normalized.objectPrefix = objectPrefix;
  }

  return normalized;
}

function normalizeScopes(scopes, workspaceId) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error(STORAGE_PROGRAMMATIC_CREDENTIAL_ERROR_CODES.INVALID_SCOPE);
  }

  return scopes.map((scope) => normalizeScope(scope, workspaceId));
}

function normalizeTtlSeconds(value) {
  const ttlSeconds = Number(value ?? DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 60) {
    throw new Error(STORAGE_PROGRAMMATIC_CREDENTIAL_ERROR_CODES.INVALID_TTL);
  }

  return Math.min(Math.trunc(ttlSeconds), DEFAULT_MAX_TTL_SECONDS);
}

function deriveCredentialId({ workspaceId, principal, displayName }) {
  const seed = `${workspaceId}:${principal.principalType}:${principal.principalId}:${displayName}`;
  return `stc_${hashSeed(seed, 18)}`;
}

function deriveAccessKeyId({ credentialId, secretVersion }) {
  return `AKST${hashSeed(`${credentialId}:${secretVersion}`, 16).toUpperCase()}`;
}

function deriveSecretAccessKey({ credentialId, secretVersion }) {
  return `sk_${hashSeed(`${credentialId}:${secretVersion}:secret`, 32)}`;
}

function maskAccessKeyId(accessKeyId) {
  const value = assertNonEmptyString(accessKeyId, 'accessKeyId');
  if (value.length <= 8) {
    return '*'.repeat(value.length);
  }

  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function normalizeExpiresAt({ expiresAt, createdAt, ttlSeconds, state }) {
  if (state === STORAGE_PROGRAMMATIC_CREDENTIAL_STATES.REVOKED) {
    return normalizeOptionalString(expiresAt) ? toIso(expiresAt) : null;
  }

  if (expiresAt) {
    return toIso(expiresAt);
  }

  return new Date(new Date(createdAt).getTime() + ttlSeconds * 1000).toISOString();
}

export const STORAGE_PROGRAMMATIC_CREDENTIAL_TYPES = Object.freeze({
  ACCESS_KEY: 'access_key'
});

export const STORAGE_PROGRAMMATIC_CREDENTIAL_STATES = Object.freeze({
  ACTIVE: 'active',
  REVOKED: 'revoked',
  EXPIRED: 'expired'
});

export const STORAGE_PROGRAMMATIC_CREDENTIAL_ALLOWED_ACTIONS = Object.freeze(Object.values(STORAGE_POLICY_ACTIONS));

export const STORAGE_PROGRAMMATIC_CREDENTIAL_ERROR_CODES = Object.freeze({
  INVALID_PRINCIPAL_TYPE: 'INVALID_PRINCIPAL_TYPE',
  INVALID_CREDENTIAL_TYPE: 'INVALID_CREDENTIAL_TYPE',
  INVALID_SCOPE: 'INVALID_SCOPE',
  INVALID_OPERATION: 'INVALID_OPERATION',
  INVALID_STATE: 'INVALID_STATE',
  INVALID_TTL: 'INVALID_TTL',
  SCOPE_OUTSIDE_WORKSPACE: 'SCOPE_OUTSIDE_WORKSPACE'
});

export function buildStorageProgrammaticCredentialRecord(input = {}) {
  const workspaceId = assertNonEmptyString(input.workspaceId, 'workspaceId');
  const principal = normalizePrincipal(input.principal ?? input);
  const displayName = assertNonEmptyString(input.displayName ?? input.credentialName ?? input.credentialId ?? 'storage-credential', 'displayName');
  const now = toIso(input.now ?? input.createdAt ?? DEFAULT_NOW);
  const credentialId = normalizeOptionalString(input.credentialId) ?? deriveCredentialId({ workspaceId, principal, displayName });
  const secretVersion = Math.max(1, Number(input.secretVersion ?? 1));
  const state = normalizeState(input.state);
  const credentialType = normalizeCredentialType(input.credentialType);
  const ttlSeconds = normalizeTtlSeconds(input.ttlSeconds);
  const accessKeyId = normalizeOptionalString(input.accessKeyId) ?? deriveAccessKeyId({ credentialId, secretVersion });
  const createdAt = toIso(input.createdAt ?? now);
  const updatedAt = toIso(input.updatedAt ?? now);
  const expiresAt = normalizeExpiresAt({ expiresAt: input.expiresAt, createdAt, ttlSeconds, state });
  const revokedAt = state === STORAGE_PROGRAMMATIC_CREDENTIAL_STATES.REVOKED
    ? toIso(input.revokedAt ?? now)
    : null;

  return {
    credentialId,
    workspaceId,
    tenantId: normalizeOptionalString(input.tenantId) ?? null,
    displayName,
    credentialType,
    principal,
    state,
    scopes: normalizeScopes(input.scopes, workspaceId),
    accessKeyIdMasked: maskAccessKeyId(accessKeyId),
    secretVersion,
    ttlSeconds,
    createdAt,
    updatedAt,
    lastRotatedAt: toIso(input.lastRotatedAt ?? createdAt),
    expiresAt,
    revokedAt,
    issuer: {
      actorId: normalizeOptionalString(input.actorId) ?? null,
      actorType: normalizeOptionalString(input.actorType) ?? null,
      originSurface: normalizeOptionalString(input.originSurface) ?? null,
      correlationId: normalizeOptionalString(input.correlationId) ?? null
    }
  };
}

export function buildStorageProgrammaticCredentialSecretEnvelope(input = {}) {
  const credential = buildStorageProgrammaticCredentialRecord(input);
  const accessKeyId = normalizeOptionalString(input.accessKeyId) ?? deriveAccessKeyId({
    credentialId: credential.credentialId,
    secretVersion: credential.secretVersion
  });

  return {
    credential,
    accessKeyId,
    secretAccessKey: normalizeOptionalString(input.secretAccessKey) ?? deriveSecretAccessKey({
      credentialId: credential.credentialId,
      secretVersion: credential.secretVersion
    }),
    secretDelivery: 'one_time'
  };
}

export function buildStorageProgrammaticCredentialCollection(input = {}) {
  return {
    items: (input.items ?? []).map((item) =>
      item?.credentialId && Array.isArray(item?.scopes)
        ? buildStorageProgrammaticCredentialRecord(item)
        : buildStorageProgrammaticCredentialRecord({ ...input, ...item })
    )
  };
}

export function rotateStorageProgrammaticCredential(input = {}) {
  const current = input.credential?.credentialId
    ? buildStorageProgrammaticCredentialRecord(input.credential)
    : buildStorageProgrammaticCredentialRecord(input);
  const requestedAt = toIso(input.requestedAt ?? input.now ?? DEFAULT_NOW);

  return buildStorageProgrammaticCredentialSecretEnvelope({
    ...current,
    actorId: input.actorId ?? current.issuer.actorId,
    actorType: input.actorType ?? current.issuer.actorType,
    originSurface: input.originSurface ?? current.issuer.originSurface,
    correlationId: input.correlationId ?? current.issuer.correlationId,
    secretVersion: current.secretVersion + 1,
    updatedAt: requestedAt,
    lastRotatedAt: requestedAt,
    createdAt: current.createdAt,
    state: STORAGE_PROGRAMMATIC_CREDENTIAL_STATES.ACTIVE
  });
}

export function revokeStorageProgrammaticCredential(input = {}) {
  const current = input.credential?.credentialId
    ? buildStorageProgrammaticCredentialRecord(input.credential)
    : buildStorageProgrammaticCredentialRecord(input);
  const requestedAt = toIso(input.requestedAt ?? input.now ?? DEFAULT_NOW);

  return buildStorageProgrammaticCredentialRecord({
    ...current,
    actorId: input.actorId ?? current.issuer.actorId,
    actorType: input.actorType ?? current.issuer.actorType,
    originSurface: input.originSurface ?? current.issuer.originSurface,
    correlationId: input.correlationId ?? current.issuer.correlationId,
    state: STORAGE_PROGRAMMATIC_CREDENTIAL_STATES.REVOKED,
    revokedAt: requestedAt,
    updatedAt: requestedAt,
    lastRotatedAt: current.lastRotatedAt,
    createdAt: current.createdAt
  });
}
