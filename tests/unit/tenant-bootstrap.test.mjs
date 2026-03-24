import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getInitialTenantBootstrapTemplate,
  listInitialTenantBootstrapTemplates,
  resolveInitialTenantBootstrap,
  resolveTenantEffectiveCapabilities
} from '../../services/internal-contracts/src/index.mjs';

test('initial tenant bootstrap templates distinguish always-created and capability-gated resources', () => {
  const templates = listInitialTenantBootstrapTemplates();
  const mongoTemplate = getInitialTenantBootstrapTemplate('default_mongo_database');

  assert.equal(templates.length >= 8, true);
  assert.equal(templates.some((template) => template.resourceKey === 'tenant_identity_context' && template.provisioningMode === 'always'), true);
  assert.equal(templates.some((template) => template.resourceKey === 'default_postgres' && template.provisioningMode === 'always'), true);
  assert.equal(templates.some((template) => template.resourceKey === 'default_storage_bucket' && template.provisioningMode === 'always'), true);
  assert.equal(templates.some((template) => template.resourceKey === 'default_event_topic' && template.provisioningMode === 'capability_gated'), true);
  assert.equal(templates.some((template) => template.resourceKey === 'default_function_action' && template.provisioningMode === 'capability_gated'), true);
  assert.ok(mongoTemplate);
  assert.equal(mongoTemplate.requiredCapabilityKey, 'data.mongodb.database');
});

test('initial tenant bootstrap resolution stays idempotent and plan/profile aware', () => {
  const starter = resolveInitialTenantBootstrap({
    tenantId: 'ten_01starter',
    ownerUserId: 'usr_01starterowner',
    workspaceId: 'wrk_01starterdev',
    workspaceEnvironment: 'dev',
    planId: 'pln_01starter'
  });
  const enterprise = resolveInitialTenantBootstrap({
    tenantId: 'ten_01enterprise',
    ownerUserId: 'usr_01enterpriseowner',
    workspaceId: 'wrk_01enterprisedev',
    workspaceEnvironment: 'prod',
    planId: 'pln_01enterprise'
  });
  const enterpriseCapabilities = resolveTenantEffectiveCapabilities({ tenantId: 'ten_01enterprise', planId: 'pln_01enterprise' });

  assert.equal(starter.status, 'pending');
  assert.equal(starter.ownerBindings.length, 2);
  assert.equal(starter.retry.retryable, false);
  assert.equal(starter.resourceStates.some((state) => state.resourceKey === 'default_postgres' && state.status === 'pending'), true);
  assert.equal(starter.resourceStates.some((state) => state.resourceKey === 'default_storage_bucket' && state.status === 'pending'), true);
  assert.equal(starter.resourceStates.some((state) => state.resourceKey === 'default_mongo_database' && state.status === 'skipped'), true);
  assert.equal(starter.resourceStates.some((state) => state.resourceKey === 'default_event_topic' && state.status === 'skipped'), true);

  assert.equal(enterpriseCapabilities.capabilities.some((capability) => capability.capabilityKey === 'data.mongodb.database'), true);
  assert.equal(enterprise.resourceStates.some((state) => state.resourceKey === 'default_mongo_database' && state.status === 'pending'), true);
  assert.equal(enterprise.resourceStates.some((state) => state.resourceKey === 'default_event_topic' && state.status === 'pending'), true);
  assert.equal(enterprise.resourceStates.some((state) => state.resourceKey === 'default_function_action' && state.status === 'pending'), true);
  assert.equal(enterprise.retry.idempotencyKey.includes('signup-activation-ten_01enterprise'), true);
});
