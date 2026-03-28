import { createHash } from 'node:crypto';

import { STORAGE_ERROR_RETRYABILITY } from './storage-error-taxonomy.mjs';

const DEFAULT_NOW = '2026-03-28T00:00:00Z';
const DEFAULT_MAX_STATEMENTS = 64;
const DEFAULT_MAX_BYTES = 16_384;
const POLICY_MANAGEMENT_ACTION = 'bucket.get_policy';

function freezeNested(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => freezeNested(item));
    return Object.freeze(value);
  }

  Object.values(value).forEach((item) => freezeNested(item));
  return Object.freeze(value);
}

function buildFrozenRecord(value) {
  return freezeNested(value);
}

function sanitizeString(value) {
  if (typeof value !== 'string') {
    return value;
  }

  return value
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/secret:\/\/\S+/gi, '[redacted-secret-ref]');
}

function sanitizeStringsDeep(value) {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStringsDeep(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeStringsDeep(item)]));
  }

  return value;
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} is required.`);
  }

  return value.trim();
}

function hashSeed(seed, length = 16) {
  return createHash('sha256').update(String(seed)).digest('hex').slice(0, length);
}

function buildCodeDefinition(code, httpStatus, fallbackHint) {
  return buildFrozenRecord({
    code,
    httpStatus,
    retryability: STORAGE_ERROR_RETRYABILITY.NOT_RETRYABLE,
    fallbackHint
  });
}

function toIso(value, fallback = DEFAULT_NOW) {
  return new Date(value ?? fallback).toISOString();
}

function buildStatementId(input = {}) {
  if (input.statementId) {
    return String(input.statementId).trim();
  }

  const seed = JSON.stringify({
    effect: input.effect,
    principals: input.principals,
    actions: input.actions,
    conditions: input.conditions ?? []
  });
  return `stmt_${hashSeed(seed, 18)}`;
}

function normalizePrincipal(input = {}) {
  const type = assertNonEmptyString(input.type, 'principal.type');
  const value = assertNonEmptyString(input.value, 'principal.value');

  if (!Object.values(STORAGE_POLICY_PRINCIPAL_TYPES).includes(type)) {
    throw new Error(STORAGE_POLICY_NORMALIZED_ERROR_CODES.BUCKET_POLICY_INVALID.code);
  }

  return buildFrozenRecord({ type, value });
}

function normalizeCondition(input = {}) {
  const type = assertNonEmptyString(input.type, 'condition.type');
  const value = assertNonEmptyString(input.value, 'condition.value');

  if (type !== STORAGE_POLICY_CONDITION_TYPES.OBJECT_KEY_PREFIX) {
    throw new Error(STORAGE_POLICY_NORMALIZED_ERROR_CODES.BUCKET_POLICY_INVALID.code);
  }

  return buildFrozenRecord({ type, value });
}

function normalizeAction(action) {
  const normalized = assertNonEmptyString(action, 'action');
  if (!Object.values(STORAGE_POLICY_ACTIONS).includes(normalized)) {
    throw new Error(STORAGE_POLICY_NORMALIZED_ERROR_CODES.BUCKET_POLICY_INVALID.code);
  }
  return normalized;
}

function normalizeStatements(statements = []) {
  return statements.map((statement) => buildStoragePolicyStatement(statement));
}

function buildDocumentMetrics(statements = []) {
  const json = JSON.stringify(statements);
  return {
    statementCount: statements.length,
    sizeBytes: Buffer.byteLength(json, 'utf8')
  };
}

function buildPolicyRecord({ entityType, policyId, tenantId, workspaceId = null, bucketId = null, statements = [], now = DEFAULT_NOW, version = 1, lifecycleState = 'active', extra = {} } = {}) {
  const normalizedStatements = normalizeStatements(statements);
  const metrics = validateStoragePolicyDocument({ statements: normalizedStatements });
  const createdAt = toIso(extra.createdAt ?? now);
  const updatedAt = toIso(now);

  return buildFrozenRecord({
    entityType,
    policyId,
    tenantId,
    ...(workspaceId ? { workspaceId } : {}),
    ...(bucketId ? { bucketId } : {}),
    version,
    statements: normalizedStatements,
    sizeBytes: metrics.sizeBytes,
    statementCount: metrics.statementCount,
    lifecycleState,
    timestamps: {
      createdAt,
      updatedAt
    },
    ...extra
  });
}

export const STORAGE_POLICY_EFFECTS = buildFrozenRecord({
  ALLOW: 'allow',
  DENY: 'deny'
});

export const STORAGE_POLICY_PRINCIPAL_TYPES = buildFrozenRecord({
  ROLE: 'role',
  USER: 'user',
  SERVICE_ACCOUNT: 'service_account'
});

export const STORAGE_POLICY_ACTIONS = buildFrozenRecord({
  OBJECT_GET: 'object.get',
  OBJECT_PUT: 'object.put',
  OBJECT_DELETE: 'object.delete',
  OBJECT_LIST: 'object.list',
  OBJECT_HEAD: 'object.head',
  BUCKET_GET_POLICY: 'bucket.get_policy',
  MULTIPART_INITIATE: 'multipart.initiate',
  MULTIPART_UPLOAD_PART: 'multipart.upload_part',
  MULTIPART_COMPLETE: 'multipart.complete',
  MULTIPART_ABORT: 'multipart.abort',
  MULTIPART_LIST: 'multipart.list',
  PRESIGNED_GENERATE_DOWNLOAD: 'presigned.generate_download',
  PRESIGNED_GENERATE_UPLOAD: 'presigned.generate_upload'
});

export const STORAGE_POLICY_SOURCES = buildFrozenRecord({
  BUCKET_POLICY: 'bucket_policy',
  WORKSPACE_DEFAULT: 'workspace_default',
  BUILTIN_DEFAULT: 'builtin_default',
  SUPERADMIN_OVERRIDE: 'superadmin_override',
  ISOLATION_REJECTION: 'isolation_rejection'
});

export const STORAGE_POLICY_CONDITION_TYPES = buildFrozenRecord({
  OBJECT_KEY_PREFIX: 'object_key_prefix'
});

export const STORAGE_POLICY_NORMALIZED_ERROR_CODES = buildFrozenRecord({
  BUCKET_POLICY_DENIED: buildCodeDefinition('BUCKET_POLICY_DENIED', 403, 'Grant the missing action in the bucket policy or workspace default.'),
  BUCKET_POLICY_TOO_LARGE: buildCodeDefinition('BUCKET_POLICY_TOO_LARGE', 400, 'Reduce the number of statements or overall serialized policy size.'),
  BUCKET_POLICY_INVALID: buildCodeDefinition('BUCKET_POLICY_INVALID', 400, 'Correct the policy principals, actions, effect, or supported conditions.'),
  BUCKET_POLICY_NOT_FOUND: buildCodeDefinition('BUCKET_POLICY_NOT_FOUND', 404, 'Attach a bucket policy first or rely on workspace/default permissions.')
});

export function validateStoragePolicyStatement(input = {}) {
  const effect = assertNonEmptyString(input.effect, 'effect');
  if (!Object.values(STORAGE_POLICY_EFFECTS).includes(effect)) {
    throw new Error(STORAGE_POLICY_NORMALIZED_ERROR_CODES.BUCKET_POLICY_INVALID.code);
  }

  if (!Array.isArray(input.principals) || input.principals.length === 0) {
    throw new Error(STORAGE_POLICY_NORMALIZED_ERROR_CODES.BUCKET_POLICY_INVALID.code);
  }

  if (!Array.isArray(input.actions) || input.actions.length === 0) {
    throw new Error(STORAGE_POLICY_NORMALIZED_ERROR_CODES.BUCKET_POLICY_INVALID.code);
  }

  const principals = input.principals.map((principal) => normalizePrincipal(principal));
  const actions = input.actions.map((action) => normalizeAction(action));
  const conditions = Array.isArray(input.conditions)
    ? input.conditions.map((condition) => normalizeCondition(condition))
    : [];

  return buildFrozenRecord({
    valid: true,
    effect,
    principals,
    actions,
    conditions,
    statementId: buildStatementId(input)
  });
}

export function validateStoragePolicyDocument({ statements = [], maxStatements = DEFAULT_MAX_STATEMENTS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!Array.isArray(statements)) {
    throw new Error(STORAGE_POLICY_NORMALIZED_ERROR_CODES.BUCKET_POLICY_INVALID.code);
  }

  const normalizedStatements = statements.map((statement) => (
    statement?.statementId && Object.isFrozen(statement)
      ? statement
      : validateStoragePolicyStatement(statement)
  ));
  const metrics = buildDocumentMetrics(normalizedStatements);

  if (metrics.statementCount > maxStatements || metrics.sizeBytes > maxBytes) {
    throw new Error(STORAGE_POLICY_NORMALIZED_ERROR_CODES.BUCKET_POLICY_TOO_LARGE.code);
  }

  return buildFrozenRecord({
    valid: true,
    statements: normalizedStatements,
    statementCount: metrics.statementCount,
    sizeBytes: metrics.sizeBytes,
    maxStatements,
    maxBytes
  });
}

export function buildStoragePolicyStatement(input = {}) {
  const validation = validateStoragePolicyStatement(input);
  return buildFrozenRecord({
    statementId: validation.statementId,
    effect: validation.effect,
    principals: validation.principals.map((principal) => ({ ...principal })),
    actions: [...validation.actions],
    conditions: validation.conditions.map((condition) => ({ ...condition }))
  });
}

export function buildStorageBucketPolicy({ tenantId, workspaceId, bucketId, statements = [], now = DEFAULT_NOW, version = 1, policyId = null, lifecycleState = 'active' } = {}) {
  assertNonEmptyString(tenantId, 'tenantId');
  assertNonEmptyString(workspaceId, 'workspaceId');
  assertNonEmptyString(bucketId, 'bucketId');

  return buildPolicyRecord({
    entityType: 'storage_bucket_policy',
    policyId: policyId ?? `pol_${hashSeed(`${tenantId}:${workspaceId}:${bucketId}:${version}`, 18)}`,
    tenantId,
    workspaceId,
    bucketId,
    statements,
    now,
    version,
    lifecycleState
  });
}

export function buildWorkspaceStoragePermissionSet({ tenantId, workspaceId, statements = [], now = DEFAULT_NOW, version = 1, policyId = null } = {}) {
  assertNonEmptyString(tenantId, 'tenantId');
  assertNonEmptyString(workspaceId, 'workspaceId');

  return buildPolicyRecord({
    entityType: 'workspace_storage_permissions',
    policyId: policyId ?? `wsp_${hashSeed(`${tenantId}:${workspaceId}:${version}`, 18)}`,
    tenantId,
    workspaceId,
    statements,
    now,
    version
  });
}

export function buildTenantStoragePermissionTemplate({ tenantId, statements = [], now = DEFAULT_NOW, version = 1, policyId = null } = {}) {
  assertNonEmptyString(tenantId, 'tenantId');

  return buildPolicyRecord({
    entityType: 'tenant_storage_permission_template',
    policyId: policyId ?? `tpl_${hashSeed(`${tenantId}:${version}`, 18)}`,
    tenantId,
    statements,
    now,
    version
  });
}

export function buildSuperadminBucketPolicyOverride({ tenantId, workspaceId, bucketId, statements = [], originalPolicyId = null, superadminId, reason, now = DEFAULT_NOW, policyId = null } = {}) {
  assertNonEmptyString(tenantId, 'tenantId');
  assertNonEmptyString(workspaceId, 'workspaceId');
  assertNonEmptyString(bucketId, 'bucketId');
  assertNonEmptyString(superadminId, 'superadminId');
  assertNonEmptyString(reason, 'reason');

  return buildPolicyRecord({
    entityType: 'superadmin_bucket_policy_override',
    policyId: policyId ?? `ovr_${hashSeed(`${tenantId}:${workspaceId}:${bucketId}:${superadminId}:${now}`, 18)}`,
    tenantId,
    workspaceId,
    bucketId,
    statements,
    now,
    version: 1,
    extra: {
      originalPolicyId,
      superadminId,
      reason: sanitizeString(reason),
      activatedAt: toIso(now)
    }
  });
}

export function buildStoragePolicyAttachmentSummary({ policyId, source = STORAGE_POLICY_SOURCES.BUCKET_POLICY, statementCount = 0, updatedAt = DEFAULT_NOW, overrideActive = false } = {}) {
  assertNonEmptyString(policyId, 'policyId');
  return buildFrozenRecord({
    policyId,
    source,
    statementCount,
    updatedAt: toIso(updatedAt),
    overrideActive: Boolean(overrideActive)
  });
}

export function buildBuiltInWorkspaceStorageDefaults({ tenantId = 'builtin', workspaceId = 'builtin', now = DEFAULT_NOW, version = 1 } = {}) {
  return buildWorkspaceStoragePermissionSet({
    tenantId,
    workspaceId,
    now,
    version,
    policyId: `builtin_${hashSeed(`${tenantId}:${workspaceId}:builtin`, 18)}`,
    statements: [
      {
        effect: STORAGE_POLICY_EFFECTS.ALLOW,
        principals: [{ type: STORAGE_POLICY_PRINCIPAL_TYPES.ROLE, value: 'member' }],
        actions: [
          STORAGE_POLICY_ACTIONS.OBJECT_GET,
          STORAGE_POLICY_ACTIONS.OBJECT_PUT,
          STORAGE_POLICY_ACTIONS.OBJECT_LIST,
          STORAGE_POLICY_ACTIONS.OBJECT_HEAD,
          STORAGE_POLICY_ACTIONS.PRESIGNED_GENERATE_DOWNLOAD,
          STORAGE_POLICY_ACTIONS.PRESIGNED_GENERATE_UPLOAD,
          STORAGE_POLICY_ACTIONS.MULTIPART_INITIATE,
          STORAGE_POLICY_ACTIONS.MULTIPART_UPLOAD_PART,
          STORAGE_POLICY_ACTIONS.MULTIPART_COMPLETE,
          STORAGE_POLICY_ACTIONS.MULTIPART_ABORT,
          STORAGE_POLICY_ACTIONS.MULTIPART_LIST
        ]
      },
      {
        effect: STORAGE_POLICY_EFFECTS.ALLOW,
        principals: [{ type: STORAGE_POLICY_PRINCIPAL_TYPES.ROLE, value: 'admin' }],
        actions: Object.values(STORAGE_POLICY_ACTIONS)
      }
    ]
  });
}

export function applyTenantStorageTemplateToWorkspace({ tenantTemplate, workspaceId, now = DEFAULT_NOW } = {}) {
  if (!tenantTemplate || tenantTemplate.entityType !== 'tenant_storage_permission_template') {
    throw new Error(STORAGE_POLICY_NORMALIZED_ERROR_CODES.BUCKET_POLICY_INVALID.code);
  }

  return buildWorkspaceStoragePermissionSet({
    tenantId: tenantTemplate.tenantId,
    workspaceId: assertNonEmptyString(workspaceId, 'workspaceId'),
    statements: tenantTemplate.statements.map((statement) => ({
      statementId: statement.statementId,
      effect: statement.effect,
      principals: statement.principals.map((principal) => ({ ...principal })),
      actions: [...statement.actions],
      conditions: statement.conditions.map((condition) => ({ ...condition }))
    })),
    now,
    version: tenantTemplate.version
  });
}

export function matchStoragePolicyPrincipal({ principal, actor } = {}) {
  const normalizedPrincipal = principal?.type ? principal : normalizePrincipal(principal ?? {});
  const actorRoles = Array.isArray(actor?.roles) ? actor.roles : [];

  let matched = false;
  if (normalizedPrincipal.type === STORAGE_POLICY_PRINCIPAL_TYPES.ROLE) {
    matched = actorRoles.includes(normalizedPrincipal.value);
  } else if (normalizedPrincipal.type === STORAGE_POLICY_PRINCIPAL_TYPES.USER) {
    matched = actor?.type === STORAGE_POLICY_PRINCIPAL_TYPES.USER && actor?.id === normalizedPrincipal.value;
  } else if (normalizedPrincipal.type === STORAGE_POLICY_PRINCIPAL_TYPES.SERVICE_ACCOUNT) {
    matched = actor?.type === STORAGE_POLICY_PRINCIPAL_TYPES.SERVICE_ACCOUNT && actor?.id === normalizedPrincipal.value;
  }

  return buildFrozenRecord({
    principal: normalizedPrincipal,
    matched
  });
}

export function matchStoragePolicyCondition({ condition, objectKey = null } = {}) {
  const normalizedCondition = condition?.type ? condition : normalizeCondition(condition ?? {});
  const target = typeof objectKey === 'string' ? objectKey : '';
  const matched = normalizedCondition.type === STORAGE_POLICY_CONDITION_TYPES.OBJECT_KEY_PREFIX
    ? target.startsWith(normalizedCondition.value)
    : false;

  return buildFrozenRecord({
    condition: normalizedCondition,
    matched
  });
}

export function matchStoragePolicyStatement({ statement, actor, action, objectKey = null } = {}) {
  const normalizedStatement = statement?.statementId ? statement : buildStoragePolicyStatement(statement ?? {});
  const requestedAction = normalizeAction(action);
  const principalMatches = normalizedStatement.principals.map((principal) => matchStoragePolicyPrincipal({ principal, actor }));
  const conditionMatches = normalizedStatement.conditions.map((condition) => matchStoragePolicyCondition({ condition, objectKey }));
  const principalMatched = principalMatches.some((entry) => entry.matched);
  const actionMatched = normalizedStatement.actions.includes(requestedAction);
  const conditionsMatched = conditionMatches.every((entry) => entry.matched);

  return buildFrozenRecord({
    statementId: normalizedStatement.statementId,
    effect: normalizedStatement.effect,
    principalMatched,
    actionMatched,
    conditionsMatched,
    matched: principalMatched && actionMatched && conditionsMatched,
    principalMatches,
    conditionMatches
  });
}

export function evaluateStoragePolicy({ policy, actor, action, objectKey = null } = {}) {
  const statements = Array.isArray(policy?.statements) ? policy.statements : [];
  const matches = statements.map((statement) => ({
    statement,
    result: matchStoragePolicyStatement({ statement, actor, action, objectKey })
  })).filter((entry) => entry.result.matched);

  const denyMatch = matches.find((entry) => entry.statement.effect === STORAGE_POLICY_EFFECTS.DENY);
  if (denyMatch) {
    return buildFrozenRecord({
      allowed: false,
      outcome: 'deny',
      matchedStatementId: denyMatch.statement.statementId,
      missingAction: action,
      reasonCode: STORAGE_POLICY_NORMALIZED_ERROR_CODES.BUCKET_POLICY_DENIED.code
    });
  }

  const allowMatch = matches.find((entry) => entry.statement.effect === STORAGE_POLICY_EFFECTS.ALLOW);
  if (allowMatch) {
    return buildFrozenRecord({
      allowed: true,
      outcome: 'allow',
      matchedStatementId: allowMatch.statement.statementId,
      missingAction: null,
      reasonCode: null
    });
  }

  return buildFrozenRecord({
    allowed: false,
    outcome: 'deny',
    matchedStatementId: null,
    missingAction: action,
    reasonCode: STORAGE_POLICY_NORMALIZED_ERROR_CODES.BUCKET_POLICY_DENIED.code
  });
}

export function evaluateStorageAccessDecision({ isolationAllowed = true, bucketPolicy = null, workspaceDefault = null, builtinDefault = null, overridePolicy = null, actor = {}, action, tenantId, workspaceId, bucketId, objectKey = null, managementOperation = false } = {}) {
  const requestedAction = normalizeAction(action);
  const actorRoles = Array.isArray(actor.roles) ? actor.roles : [];
  const adminBypass = Boolean(managementOperation) && actorRoles.includes('admin') && requestedAction === POLICY_MANAGEMENT_ACTION;

  if (!isolationAllowed) {
    return buildFrozenRecord({
      allowed: false,
      outcome: 'deny',
      source: STORAGE_POLICY_SOURCES.ISOLATION_REJECTION,
      matchedStatementId: null,
      missingAction: requestedAction,
      actor: buildFrozenRecord({ type: actor.type ?? 'user', id: actor.id ?? null, roles: [...actorRoles] }),
      action: requestedAction,
      tenantId,
      workspaceId,
      bucketId,
      ...(objectKey ? { objectKey } : {}),
      reasonCode: 'ISOLATION_REJECTION'
    });
  }

  if (adminBypass) {
    return buildFrozenRecord({
      allowed: true,
      outcome: 'allow',
      source: overridePolicy
        ? STORAGE_POLICY_SOURCES.SUPERADMIN_OVERRIDE
        : bucketPolicy
          ? STORAGE_POLICY_SOURCES.BUCKET_POLICY
          : workspaceDefault
            ? STORAGE_POLICY_SOURCES.WORKSPACE_DEFAULT
            : STORAGE_POLICY_SOURCES.BUILTIN_DEFAULT,
      matchedStatementId: null,
      missingAction: null,
      actor: buildFrozenRecord({ type: actor.type ?? 'user', id: actor.id ?? null, roles: [...actorRoles] }),
      action: requestedAction,
      tenantId,
      workspaceId,
      bucketId,
      ...(objectKey ? { objectKey } : {}),
      reasonCode: null
    });
  }

  const effectiveBuiltin = builtinDefault ?? buildBuiltInWorkspaceStorageDefaults({ tenantId, workspaceId });
  const orderedPolicies = [
    { source: STORAGE_POLICY_SOURCES.SUPERADMIN_OVERRIDE, policy: overridePolicy },
    { source: STORAGE_POLICY_SOURCES.BUCKET_POLICY, policy: bucketPolicy },
    { source: STORAGE_POLICY_SOURCES.WORKSPACE_DEFAULT, policy: workspaceDefault },
    { source: STORAGE_POLICY_SOURCES.BUILTIN_DEFAULT, policy: effectiveBuiltin }
  ].filter((entry) => entry.policy);

  for (const entry of orderedPolicies) {
    const evaluation = evaluateStoragePolicy({ policy: entry.policy, actor, action: requestedAction, objectKey });
    return buildFrozenRecord({
      allowed: evaluation.allowed,
      outcome: evaluation.outcome,
      source: entry.source,
      matchedStatementId: evaluation.matchedStatementId,
      missingAction: evaluation.missingAction,
      actor: buildFrozenRecord({ type: actor.type ?? 'user', id: actor.id ?? null, roles: [...actorRoles] }),
      action: requestedAction,
      tenantId,
      workspaceId,
      bucketId,
      ...(objectKey ? { objectKey } : {}),
      reasonCode: evaluation.reasonCode
    });
  }

  return buildFrozenRecord({
    allowed: false,
    outcome: 'deny',
    source: STORAGE_POLICY_SOURCES.BUILTIN_DEFAULT,
    matchedStatementId: null,
    missingAction: requestedAction,
    actor: buildFrozenRecord({ type: actor.type ?? 'user', id: actor.id ?? null, roles: [...actorRoles] }),
    action: requestedAction,
    tenantId,
    workspaceId,
    bucketId,
    ...(objectKey ? { objectKey } : {}),
    reasonCode: STORAGE_POLICY_NORMALIZED_ERROR_CODES.BUCKET_POLICY_DENIED.code
  });
}

export function buildStoragePolicyDecisionAuditEvent({ decision, actor = null, occurredAt = DEFAULT_NOW, correlationId = null } = {}) {
  const effectiveActor = actor ?? decision?.actor ?? {};
  return buildFrozenRecord(sanitizeStringsDeep({
    eventType: 'storage.policy.decision',
    entityType: 'storage_policy_decision',
    tenantId: decision?.tenantId ?? null,
    workspaceId: decision?.workspaceId ?? null,
    bucketId: decision?.bucketId ?? null,
    ...(decision?.objectKey ? { objectKey: decision.objectKey } : {}),
    action: decision?.action ?? null,
    source: decision?.source ?? null,
    matchedStatementId: decision?.matchedStatementId ?? 'no-match-implicit-deny',
    outcome: decision?.outcome ?? 'deny',
    reasonCode: decision?.reasonCode ?? null,
    actor: {
      type: effectiveActor.type ?? null,
      id: effectiveActor.id ?? null,
      roles: Array.isArray(effectiveActor.roles) ? [...effectiveActor.roles] : []
    },
    auditEnvelope: {
      correlationId,
      outcome: decision?.outcome ?? 'deny',
      occurredAt: toIso(occurredAt)
    }
  }));
}

export function buildStoragePolicyMutationAuditEvent({ operation, actor = {}, previousPolicy = null, nextPolicy = null, tenantId = null, workspaceId = null, bucketId = null, occurredAt = DEFAULT_NOW, correlationId = null } = {}) {
  return buildFrozenRecord(sanitizeStringsDeep({
    eventType: 'storage.policy.mutation',
    entityType: 'storage_policy_mutation',
    operation: assertNonEmptyString(operation, 'operation'),
    tenantId: tenantId ?? previousPolicy?.tenantId ?? nextPolicy?.tenantId ?? null,
    workspaceId: workspaceId ?? previousPolicy?.workspaceId ?? nextPolicy?.workspaceId ?? null,
    bucketId: bucketId ?? previousPolicy?.bucketId ?? nextPolicy?.bucketId ?? null,
    actor: {
      type: actor.type ?? null,
      id: actor.id ?? null,
      roles: Array.isArray(actor.roles) ? [...actor.roles] : []
    },
    previousPolicy: previousPolicy ? sanitizeStringsDeep(JSON.parse(JSON.stringify(previousPolicy))) : null,
    nextPolicy: nextPolicy ? sanitizeStringsDeep(JSON.parse(JSON.stringify(nextPolicy))) : null,
    auditEnvelope: {
      correlationId,
      outcome: 'accepted',
      occurredAt: toIso(occurredAt)
    }
  }));
}
