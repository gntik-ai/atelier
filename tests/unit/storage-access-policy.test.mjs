import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_POLICY_ACTIONS,
  STORAGE_POLICY_CONDITION_TYPES,
  STORAGE_POLICY_EFFECTS,
  STORAGE_POLICY_NORMALIZED_ERROR_CODES,
  STORAGE_POLICY_PRINCIPAL_TYPES,
  STORAGE_POLICY_SOURCES,
  applyTenantStorageTemplateToWorkspace,
  buildBuiltInWorkspaceStorageDefaults,
  buildStorageBucketPolicy,
  buildStoragePolicyDecisionAuditEvent,
  buildStoragePolicyMutationAuditEvent,
  buildStoragePolicyStatement,
  buildSuperadminBucketPolicyOverride,
  buildTenantStoragePermissionTemplate,
  buildWorkspaceStoragePermissionSet,
  evaluateStorageAccessDecision,
  evaluateStoragePolicy,
  matchStoragePolicyCondition,
  matchStoragePolicyPrincipal,
  matchStoragePolicyStatement,
  validateStoragePolicyDocument,
  validateStoragePolicyStatement
} from '../../services/adapters/src/storage-access-policy.mjs';

test('policy catalogs and nested error definitions are frozen and additive', () => {
  assert.equal(Object.isFrozen(STORAGE_POLICY_EFFECTS), true);
  assert.equal(Object.isFrozen(STORAGE_POLICY_ACTIONS), true);
  assert.equal(Object.isFrozen(STORAGE_POLICY_NORMALIZED_ERROR_CODES), true);
  assert.equal(Object.isFrozen(STORAGE_POLICY_NORMALIZED_ERROR_CODES.BUCKET_POLICY_DENIED), true);
  assert.equal(STORAGE_POLICY_ACTIONS.MULTIPART_COMPLETE, 'multipart.complete');
  assert.equal(STORAGE_POLICY_ACTIONS.PRESIGNED_GENERATE_UPLOAD, 'presigned.generate_upload');
  assert.equal(STORAGE_POLICY_NORMALIZED_ERROR_CODES.BUCKET_POLICY_TOO_LARGE.retryability, 'not_retryable');
  assert.equal(typeof STORAGE_POLICY_NORMALIZED_ERROR_CODES.BUCKET_POLICY_INVALID.fallbackHint, 'string');
});

test('statement and document validation reject malformed values and allow empty docs', () => {
  const valid = validateStoragePolicyStatement({
    effect: 'allow',
    principals: [{ type: 'role', value: 'viewer' }],
    actions: ['object.get'],
    conditions: [{ type: 'object_key_prefix', value: 'public/' }]
  });
  const emptyDoc = validateStoragePolicyDocument({ statements: [] });

  assert.equal(valid.valid, true);
  assert.equal(emptyDoc.statementCount, 0);

  assert.throws(() => validateStoragePolicyStatement({ effect: 'maybe', principals: [{ type: 'role', value: 'viewer' }], actions: ['object.get'] }), /BUCKET_POLICY_INVALID/);
  assert.throws(() => validateStoragePolicyStatement({ effect: 'allow', principals: [], actions: ['object.get'] }), /BUCKET_POLICY_INVALID/);
  assert.throws(() => validateStoragePolicyStatement({ effect: 'allow', principals: [{ type: 'group', value: 'viewer' }], actions: ['object.get'] }), /BUCKET_POLICY_INVALID/);
  assert.throws(() => validateStoragePolicyStatement({ effect: 'allow', principals: [{ type: 'role', value: 'viewer' }], actions: ['object.fly'] }), /BUCKET_POLICY_INVALID/);
  assert.throws(() => validateStoragePolicyStatement({ effect: 'allow', principals: [{ type: 'role', value: 'viewer' }], actions: ['object.get'], conditions: [{ type: 'ip_range', value: '127.0.0.1/32' }] }), /BUCKET_POLICY_INVALID/);
  assert.throws(() => validateStoragePolicyDocument({ statements: new Array(80).fill({ effect: 'allow', principals: [{ type: 'role', value: 'viewer' }], actions: ['object.get'] }) }), /BUCKET_POLICY_TOO_LARGE/);
});

test('principal, condition, and statement matching are deterministic', () => {
  const actor = { type: 'service_account', id: 'svc_uploads', roles: ['uploader'] };
  const principalMatch = matchStoragePolicyPrincipal({ principal: { type: 'service_account', value: 'svc_uploads' }, actor });
  const conditionMatch = matchStoragePolicyCondition({ condition: { type: 'object_key_prefix', value: 'incoming/' }, objectKey: 'incoming/file.txt' });
  const statementMatch = matchStoragePolicyStatement({
    statement: buildStoragePolicyStatement({
      effect: 'allow',
      principals: [{ type: 'role', value: 'uploader' }],
      actions: ['object.put'],
      conditions: [{ type: 'object_key_prefix', value: 'incoming/' }]
    }),
    actor,
    action: 'object.put',
    objectKey: 'incoming/file.txt'
  });

  assert.equal(principalMatch.matched, true);
  assert.equal(conditionMatch.matched, true);
  assert.equal(statementMatch.matched, true);
});

test('policy evaluation enforces deny-wins, implicit deny, and prefix conditions', () => {
  const policy = buildStorageBucketPolicy({
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    bucketId: 'bkt_01',
    statements: [
      { effect: 'allow', principals: [{ type: 'role', value: 'viewer' }], actions: ['object.get'] },
      { effect: 'deny', principals: [{ type: 'role', value: 'viewer' }], actions: ['object.get'], conditions: [{ type: 'object_key_prefix', value: 'private/' }] }
    ]
  });

  const allowed = evaluateStoragePolicy({ policy, actor: { type: 'user', id: 'usr_01', roles: ['viewer'] }, action: 'object.get', objectKey: 'public/file.txt' });
  const denied = evaluateStoragePolicy({ policy, actor: { type: 'user', id: 'usr_01', roles: ['viewer'] }, action: 'object.get', objectKey: 'private/file.txt' });
  const implicit = evaluateStoragePolicy({ policy, actor: { type: 'user', id: 'usr_02', roles: ['member'] }, action: 'object.delete', objectKey: 'public/file.txt' });

  assert.equal(allowed.allowed, true);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reasonCode, 'BUCKET_POLICY_DENIED');
  assert.equal(implicit.matchedStatementId, null);
});

test('access decision uses precedence: isolation, override, bucket, workspace, builtin', () => {
  const actor = { type: 'user', id: 'usr_01', roles: ['member'] };
  const workspaceDefault = buildWorkspaceStoragePermissionSet({
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    statements: [{ effect: 'allow', principals: [{ type: 'role', value: 'member' }], actions: ['object.put'] }]
  });
  const bucketPolicy = buildStorageBucketPolicy({
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    bucketId: 'bkt_01',
    statements: [{ effect: 'deny', principals: [{ type: 'role', value: 'member' }], actions: ['object.put'] }]
  });
  const override = buildSuperadminBucketPolicyOverride({
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    bucketId: 'bkt_01',
    originalPolicyId: bucketPolicy.policyId,
    superadminId: 'sup_01',
    reason: 'https://incident.local/1 uses secret://tenants/ten_01',
    statements: [{ effect: 'allow', principals: [{ type: 'role', value: 'member' }], actions: ['object.put'] }]
  });

  const isolation = evaluateStorageAccessDecision({ isolationAllowed: false, actor, action: 'object.put', tenantId: 'ten_01', workspaceId: 'wrk_01', bucketId: 'bkt_01' });
  const withOverride = evaluateStorageAccessDecision({ isolationAllowed: true, overridePolicy: override, bucketPolicy, workspaceDefault, actor, action: 'object.put', tenantId: 'ten_01', workspaceId: 'wrk_01', bucketId: 'bkt_01' });
  const withBucket = evaluateStorageAccessDecision({ isolationAllowed: true, bucketPolicy, workspaceDefault, actor, action: 'object.put', tenantId: 'ten_01', workspaceId: 'wrk_01', bucketId: 'bkt_01' });
  const withWorkspace = evaluateStorageAccessDecision({ isolationAllowed: true, workspaceDefault, actor, action: 'object.put', tenantId: 'ten_01', workspaceId: 'wrk_01', bucketId: 'bkt_01' });
  const builtin = evaluateStorageAccessDecision({ isolationAllowed: true, actor, action: 'object.get', tenantId: 'ten_01', workspaceId: 'wrk_01', bucketId: 'bkt_01' });

  assert.equal(isolation.source, STORAGE_POLICY_SOURCES.ISOLATION_REJECTION);
  assert.equal(withOverride.source, STORAGE_POLICY_SOURCES.SUPERADMIN_OVERRIDE);
  assert.equal(withOverride.allowed, true);
  assert.equal(withBucket.source, STORAGE_POLICY_SOURCES.BUCKET_POLICY);
  assert.equal(withBucket.allowed, false);
  assert.equal(withWorkspace.source, STORAGE_POLICY_SOURCES.WORKSPACE_DEFAULT);
  assert.equal(withWorkspace.allowed, true);
  assert.equal(builtin.source, STORAGE_POLICY_SOURCES.BUILTIN_DEFAULT);
  assert.equal(builtin.allowed, true);
});

test('workspace admin management access cannot be self-revoked', () => {
  const bucketPolicy = buildStorageBucketPolicy({
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    bucketId: 'bkt_01',
    statements: [{ effect: 'deny', principals: [{ type: 'role', value: 'admin' }], actions: ['bucket.get_policy'] }]
  });

  const decision = evaluateStorageAccessDecision({
    isolationAllowed: true,
    bucketPolicy,
    actor: { type: 'user', id: 'usr_admin', roles: ['admin'] },
    action: 'bucket.get_policy',
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    bucketId: 'bkt_01',
    managementOperation: true
  });

  assert.equal(decision.allowed, true);
});

test('builders return frozen normalized records and tenant template application clones', () => {
  const tenantTemplate = buildTenantStoragePermissionTemplate({
    tenantId: 'ten_01',
    statements: [{ effect: 'allow', principals: [{ type: 'role', value: 'viewer' }], actions: ['object.get'] }]
  });
  const workspaceDefault = applyTenantStorageTemplateToWorkspace({ tenantTemplate, workspaceId: 'wrk_02' });
  const builtin = buildBuiltInWorkspaceStorageDefaults({ tenantId: 'ten_01', workspaceId: 'wrk_02' });

  assert.equal(Object.isFrozen(tenantTemplate), true);
  assert.equal(Object.isFrozen(workspaceDefault), true);
  assert.equal(Object.isFrozen(builtin), true);
  assert.equal(workspaceDefault.entityType, 'workspace_storage_permissions');
  assert.notEqual(workspaceDefault.policyId, tenantTemplate.policyId);
  assert.deepEqual(workspaceDefault.statements[0].actions, ['object.get']);
});

test('decision and mutation audit events are frozen and sanitized', () => {
  const decision = evaluateStorageAccessDecision({
    isolationAllowed: true,
    actor: { type: 'user', id: 'usr_01', roles: ['member'] },
    action: 'object.get',
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    bucketId: 'bkt_01',
    objectKey: 'shared/readme.txt'
  });
  const decisionEvent = buildStoragePolicyDecisionAuditEvent({ decision, correlationId: 'cor_01' });
  const mutationEvent = buildStoragePolicyMutationAuditEvent({
    operation: 'override',
    actor: { type: STORAGE_POLICY_PRINCIPAL_TYPES.USER, id: 'sup_01', roles: ['superadmin'] },
    previousPolicy: buildStorageBucketPolicy({ tenantId: 'ten_01', workspaceId: 'wrk_01', bucketId: 'bkt_01', statements: [] }),
    nextPolicy: buildSuperadminBucketPolicyOverride({
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      bucketId: 'bkt_01',
      originalPolicyId: 'pol_prev',
      superadminId: 'sup_01',
      reason: 'https://internal.example/incident secret://tenants/ten_01/storage',
      statements: [{ effect: 'allow', principals: [{ type: 'user', value: 'usr_01' }], actions: ['object.get'] }]
    }),
    correlationId: 'cor_02'
  });

  assert.equal(Object.isFrozen(decisionEvent), true);
  assert.equal(Object.isFrozen(mutationEvent), true);
  assert.equal(JSON.stringify(decisionEvent).includes('https://'), false);
  assert.equal(JSON.stringify(mutationEvent).includes('https://internal.example'), false);
  assert.equal(JSON.stringify(mutationEvent).includes('secret://tenants/'), false);
});
