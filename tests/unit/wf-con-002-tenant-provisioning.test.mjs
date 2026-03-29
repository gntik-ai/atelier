import test from 'node:test';
import assert from 'node:assert/strict';

import { _resetForTest as resetIdempotencyStore } from '../../apps/control-plane/src/workflows/idempotency-store.mjs';
import { _resetForTest as resetJobStatus } from '../../apps/control-plane/src/workflows/job-status.mjs';
import handleTenantProvisioning, {
  __resetWorkflowDependenciesForTest,
  __setWorkflowDependenciesForTest,
  runTenantProvisioningAction
} from '../../apps/control-plane/src/workflows/wf-con-002-tenant-provisioning.mjs';

function request(overrides = {}) {
  return {
    workflowId: 'WF-CON-002',
    idempotencyKey: '22222222-2222-4222-8222-222222222222',
    callerContext: {
      actor: 'superadmin-1',
      actorType: 'superadmin',
      tenantId: 'platform',
      workspaceId: 'platform',
      correlationId: 'corr-2'
    },
    input: {
      tenantSlug: 'tenant-one',
      tenantDisplayName: 'Tenant One',
      adminEmail: 'admin@example.com'
    },
    ...overrides,
    callerContext: {
      actor: 'superadmin-1',
      actorType: 'superadmin',
      tenantId: 'platform',
      workspaceId: 'platform',
      correlationId: 'corr-2',
      ...(overrides.callerContext ?? {})
    },
    input: {
      tenantSlug: 'tenant-one',
      tenantDisplayName: 'Tenant One',
      adminEmail: 'admin@example.com',
      ...(overrides.input ?? {})
    }
  };
}

test.afterEach(() => {
  resetIdempotencyStore();
  resetJobStatus();
  __resetWorkflowDependenciesForTest();
});

test('non-superadmin token is rejected before any processing', async () => {
  let registerJobCalls = 0;
  __setWorkflowDependenciesForTest({
    async registerJob() {
      registerJobCalls += 1;
      return 'job';
    }
  });

  const result = await handleTenantProvisioning(request({ callerContext: { actorType: 'workspace_admin' } }));
  assert.equal(result.errorSummary.code, 'FORBIDDEN');
  assert.equal(registerJobCalls, 0);
});

test('superadmin request returns pending jobRef', async () => {
  __setWorkflowDependenciesForTest({
    async dispatchWorkflowAction() {
      return { activationId: 'act-1' };
    }
  });

  const result = await handleTenantProvisioning(request());
  assert.equal(result.status, 'pending');
  assert.match(result.jobRef, /^wf_job_WF-CON-002_/);
});

test('registerJob and dispatchWorkflowAction are invoked with correct action ref', async () => {
  let registered = 0;
  let dispatched = null;
  __setWorkflowDependenciesForTest({
    async registerJob(...args) {
      registered += 1;
      return `wf_job_WF-CON-002_${args[1].replace(/-/g, '')}`;
    },
    async dispatchWorkflowAction(namespace, actionRef) {
      dispatched = { namespace, actionRef };
      return { activationId: 'act-1' };
    }
  });

  await handleTenantProvisioning(request());
  assert.equal(registered, 1);
  assert.equal(dispatched.actionRef, 'console/wf-con-002-tenant-provisioning');
});

test('async action success updates job status to succeeded', async () => {
  __setWorkflowDependenciesForTest({
    async dispatchWorkflowAction() {
      return { activationId: 'act-1' };
    },
    async createRealm() {
      return { realmId: 'tenant-one' };
    },
    async writeTenantRecord() {
      return { tenantId: 'tenant-one' };
    },
    async createTopicNamespace() {
      return { namespaceId: 'tenant-one-ns' };
    },
    async registerApisixRoutes() {
      return { routeId: 'route-1' };
    }
  });

  const pending = await handleTenantProvisioning(request());
  const result = await runTenantProvisioningAction({ ...request(), jobRef: pending.jobRef });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.tenantSlug, 'tenant-one');
});

test('async action failing at Kafka step marks create_kafka_namespace', async () => {
  __setWorkflowDependenciesForTest({
    async dispatchWorkflowAction() {
      return { activationId: 'act-1' };
    },
    async createRealm() {
      return { realmId: 'tenant-one' };
    },
    async writeTenantRecord() {
      return { tenantId: 'tenant-one' };
    },
    async createTopicNamespace() {
      const error = new Error('kafka unavailable');
      error.failedStep = 'create_kafka_namespace';
      throw error;
    }
  });

  const pending = await handleTenantProvisioning(request({ idempotencyKey: '23222222-2222-4222-8222-222222222222' }));
  const result = await runTenantProvisioningAction({ ...request({ idempotencyKey: '23222222-2222-4222-8222-222222222222' }), jobRef: pending.jobRef });
  assert.equal(result.status, 'failed');
  assert.equal(result.errorSummary.failedStep, 'create_kafka_namespace');
});

test('async action failing at Keycloak step marks create_keycloak_realm', async () => {
  __setWorkflowDependenciesForTest({
    async dispatchWorkflowAction() {
      return { activationId: 'act-1' };
    },
    async createRealm() {
      const error = new Error('keycloak unavailable');
      error.failedStep = 'create_keycloak_realm';
      throw error;
    }
  });

  const pending = await handleTenantProvisioning(request({ idempotencyKey: '24222222-2222-4222-8222-222222222222' }));
  const result = await runTenantProvisioningAction({ ...request({ idempotencyKey: '24222222-2222-4222-8222-222222222222' }), jobRef: pending.jobRef });
  assert.equal(result.status, 'failed');
  assert.equal(result.errorSummary.failedStep, 'create_keycloak_realm');
});

test('duplicate pending idempotency key returns cached jobRef without new registration', async () => {
  let registered = 0;
  __setWorkflowDependenciesForTest({
    async registerJob(...args) {
      registered += 1;
      return `wf_job_WF-CON-002_${args[1].replace(/-/g, '')}`;
    },
    async dispatchWorkflowAction() {
      return { activationId: 'act-1' };
    }
  });

  const first = await handleTenantProvisioning(request());
  const second = await handleTenantProvisioning(request());
  assert.equal(first.status, 'pending');
  assert.equal(second.status, 'pending');
  assert.equal(second.jobRef, first.jobRef);
  assert.equal(registered, 1);
});
