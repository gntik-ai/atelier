import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IAM_ADMIN_AUDIT_CONTEXT_FIELDS,
  IAM_LIFECYCLE_EVENT_TYPES,
  buildIamLifecycleEvent,
  evaluateTenantIamAccess,
  getIamTraceabilityRoute,
  iamGovernanceApiFamily,
  listIamTraceabilityRoutes,
  summarizeIamAuditCoverage
} from '../../apps/control-plane/src/iam-governance.mjs';

test('iam governance helpers expose traceability routes and actor-rich audit coverage', () => {
  const routes = listIamTraceabilityRoutes();
  const summary = summarizeIamAuditCoverage();

  assert.equal(iamGovernanceApiFamily?.id, 'iam');
  assert.equal(routes.length, 2);
  assert.equal(routes.some((route) => route.path === '/v1/iam/tenants/{tenantId}/activity'), true);
  assert.equal(routes.some((route) => route.path === '/v1/iam/workspaces/{workspaceId}/activity'), true);
  assert.equal(getIamTraceabilityRoute('listTenantIamActivity')?.path, '/v1/iam/tenants/{tenantId}/activity');
  assert.equal(summary.traceabilityRouteCount, 2);
  assert.equal(summary.adminContextFields.every((field) => field.requestContract && field.auditContract), true);
  assert.equal(summary.lifecycleFields.includes('audit_record_id'), true);
  assert.deepEqual(IAM_ADMIN_AUDIT_CONTEXT_FIELDS, [
    'actor_id',
    'actor_type',
    'origin_surface',
    'request_ip',
    'user_agent',
    'target_tenant_id',
    'target_workspace_id'
  ]);
});

test('iam governance helper distinguishes tenant suspension, user disablement, and application revocation', () => {
  const tenantSuspended = evaluateTenantIamAccess({
    tenantState: 'suspended',
    principalType: 'user',
    principalState: 'active'
  });
  const userDisabled = evaluateTenantIamAccess({
    tenantState: 'active',
    principalType: 'user',
    principalState: 'suspended'
  });
  const applicationRevoked = evaluateTenantIamAccess({
    tenantState: 'active',
    principalType: 'service_account',
    clientState: 'revoked',
    credentialState: 'active'
  });
  const reactivated = evaluateTenantIamAccess({
    tenantState: 'active',
    principalType: 'service_account',
    clientState: 'active',
    credentialState: 'active'
  });

  assert.deepEqual(
    [tenantSuspended.reason, userDisabled.reason, applicationRevoked.reason, reactivated.reason],
    ['tenant_suspended', 'user_disabled', 'application_revoked', 'active']
  );
  assert.equal(tenantSuspended.allowed, false);
  assert.equal(userDisabled.allowed, false);
  assert.equal(applicationRevoked.allowed, false);
  assert.equal(reactivated.allowed, true);
});

test('iam governance helper builds replay-safe lifecycle events for audit and Kafka delivery', () => {
  const lifecycleEvent = buildIamLifecycleEvent({
    eventId: 'evt-iam-tenant-suspend-001',
    eventType: 'iam.tenant.access.suspended',
    action: 'suspend_tenant_access',
    actor: {
      actorId: 'usr_01tenantadmin',
      actorType: 'tenant_user',
      username: 'nora-admin',
      originSurface: 'console',
      ipAddress: '203.0.113.44',
      userAgent: 'Mozilla/5.0',
      delegationChain: ['usr_01tenantadmin', 'svc_01policyenforcer']
    },
    target: {
      resourceType: 'tenant',
      resourceId: 'ten_01starteralpha',
      tenantId: 'ten_01starteralpha',
      realmId: 'tenant-starter-alpha'
    },
    auditRecordId: 'aud_01tenantaccess',
    correlationId: 'corr-iam-tenant-001',
    suspensionState: 'suspended',
    metadata: {
      sourceStory: 'US-IAM-06'
    }
  });

  assert.equal(IAM_LIFECYCLE_EVENT_TYPES.includes(lifecycleEvent.eventType), true);
  assert.equal(lifecycleEvent.streamDelivery.deliveryMode, 'audit_and_kafka');
  assert.equal(lifecycleEvent.streamDelivery.kafkaTopic, 'iam.lifecycle');
  assert.equal(lifecycleEvent.streamDelivery.replayToken, 'evt-iam-tenant-suspend-001:corr-iam-tenant-001');
  assert.deepEqual(lifecycleEvent.actor.delegationChain, ['usr_01tenantadmin', 'svc_01policyenforcer']);
});
