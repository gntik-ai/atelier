import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQuotaHardLimitAuditEvent,
  buildQuotaHardLimitDecision,
  buildQuotaHardLimitErrorResponse,
  isQuotaHardLimitReached,
  pickStrictestHardLimitDecision,
  summarizeObservabilityHardLimitEnforcement
} from '../../apps/control-plane/src/observability-admin.mjs';
import {
  collectObservabilityHardLimitEnforcementViolations,
  readObservabilityHardLimitEnforcement
} from '../../scripts/lib/observability-hard-limit-enforcement.mjs';

test('hard-limit enforcement contract validator passes for the shipped contract', () => {
  const violations = collectObservabilityHardLimitEnforcementViolations(readObservabilityHardLimitEnforcement());
  assert.deepEqual(violations, []);
});

test('hard-limit enforcement summary exposes dimensions and surfaces', () => {
  const summary = summarizeObservabilityHardLimitEnforcement();

  assert.equal(summary.version, '2026-03-28');
  assert.equal(summary.dimensions.some((dimension) => dimension.id === 'serverless_functions'), true);
  assert.equal(summary.surfaces.some((surface) => surface.id === 'functions.action.create'), true);
  assert.equal(summary.errorContract.error_code, 'QUOTA_HARD_LIMIT_REACHED');
});

test('buildQuotaHardLimitDecision constructs an allowed decision', () => {
  const decision = buildQuotaHardLimitDecision({
    dimensionId: 'kafka_topics',
    scopeType: 'workspace',
    scopeId: 'wrk_demo',
    tenantId: 'ten_demo',
    workspaceId: 'wrk_demo',
    currentUsage: 2,
    hardLimit: 3,
    blockingAction: 'create_topic'
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.denied, false);
  assert.equal(isQuotaHardLimitReached(decision), false);
});

test('buildQuotaHardLimitDecision constructs a denied decision and canonical error response', () => {
  const decision = buildQuotaHardLimitDecision({
    dimensionId: 'serverless_functions',
    scopeType: 'workspace',
    scopeId: 'wrk_demo',
    tenantId: 'ten_demo',
    workspaceId: 'wrk_demo',
    currentUsage: 10,
    hardLimit: 10,
    blockingAction: 'create_function'
  });
  const response = buildQuotaHardLimitErrorResponse(decision);

  assert.equal(decision.denied, true);
  assert.equal(isQuotaHardLimitReached(decision), true);
  assert.equal(response.error_code, 'QUOTA_HARD_LIMIT_REACHED');
  assert.equal(response.dimension_id, 'serverless_functions');
  assert.equal(response.scope_type, 'workspace');
  assert.equal(response.hard_limit, 10);
});

test('pickStrictestHardLimitDecision prefers workspace denials over tenant denials', () => {
  const tenantDecision = buildQuotaHardLimitDecision({
    dimensionId: 'logical_databases',
    scopeType: 'tenant',
    scopeId: 'ten_demo',
    tenantId: 'ten_demo',
    currentUsage: 20,
    hardLimit: 20,
    blockingAction: 'create_database'
  });
  const workspaceDecision = buildQuotaHardLimitDecision({
    dimensionId: 'logical_databases',
    scopeType: 'workspace',
    scopeId: 'wrk_demo',
    tenantId: 'ten_demo',
    workspaceId: 'wrk_demo',
    currentUsage: 5,
    hardLimit: 5,
    blockingAction: 'create_database'
  });

  const winner = pickStrictestHardLimitDecision([tenantDecision, workspaceDecision]);
  assert.equal(winner.scopeType, 'workspace');
  assert.equal(winner.scopeId, 'wrk_demo');
});

test('buildQuotaHardLimitAuditEvent is deterministic and includes required fields', () => {
  const decision = buildQuotaHardLimitDecision({
    dimensionId: 'storage_buckets',
    scopeType: 'workspace',
    scopeId: 'wrk_demo',
    tenantId: 'ten_demo',
    workspaceId: 'wrk_demo',
    currentUsage: 4,
    hardLimit: 4,
    blockingAction: 'create_bucket',
    evaluatedAt: '2026-03-28T18:00:00Z'
  });
  const event = buildQuotaHardLimitAuditEvent(decision);

  assert.equal(event.eventType, 'quota.hard_limit.evaluated');
  assert.equal(event.decision, 'denied');
  assert.equal(event.dimensionId, 'storage_buckets');
  assert.equal(event.evaluatedAt, '2026-03-28T18:00:00Z');
});

test('missing evidence fails closed when building a decision', () => {
  const decision = buildQuotaHardLimitDecision({
    dimensionId: 'api_requests',
    scopeType: 'tenant',
    scopeId: 'ten_demo',
    tenantId: 'ten_demo',
    evidenceAvailable: false,
    blockingAction: 'request_admission'
  });

  assert.equal(decision.denied, true);
  assert.equal(decision.allowed, false);
});
