import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceCapabilityCatalogAction } from '../../services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs';

const baseClaims = {
  workspaceId: 'ws-123',
  tenantId: 'ten-123',
  actorId: 'user-123'
};

const rows = [
  {
    capability_key: 'postgres-database',
    display_name: 'PostgreSQL',
    category: 'data',
    description: 'Relational database',
    enabled: true,
    status: 'active',
    dependencies: []
  },
  {
    capability_key: 'mongo-collection',
    display_name: 'MongoDB',
    category: 'data',
    description: 'Document database',
    enabled: false,
    status: 'disabled',
    dependencies: []
  },
  {
    capability_key: 'kafka-events',
    display_name: 'Event Streaming',
    category: 'messaging',
    description: 'Kafka-based event bus',
    enabled: true,
    status: 'active',
    dependencies: []
  },
  {
    capability_key: 'realtime-subscription',
    display_name: 'Realtime Subscriptions',
    category: 'messaging',
    description: 'Realtime delivery',
    enabled: true,
    status: 'active',
    dependencies: ['kafka-events']
  },
  {
    capability_key: 'serverless-function',
    display_name: 'Serverless Functions',
    category: 'compute',
    description: 'Functions',
    enabled: true,
    status: 'active',
    dependencies: []
  },
  {
    capability_key: 'storage-bucket',
    display_name: 'Object Storage',
    category: 'storage',
    description: 'Object storage',
    enabled: true,
    status: 'active',
    dependencies: []
  }
];

test('returns 403 for mismatched workspace claim', async () => {
  const action = createWorkspaceCapabilityCatalogAction();
  const response = await action({ workspaceId: 'ws-other', auth: { claims: baseClaims } });
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error.code, 'FORBIDDEN');
});

test('returns 401 for missing JWT context', async () => {
  const action = createWorkspaceCapabilityCatalogAction();
  const response = await action({ workspaceId: 'ws-123' });
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error.code, 'UNAUTHORIZED');
});

test('returns 404 for unknown workspace', async () => {
  const action = createWorkspaceCapabilityCatalogAction({ fetchCapabilities: async () => [] });
  const response = await action({ workspaceId: 'ws-123', auth: { claims: baseClaims } });
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error.code, 'WORKSPACE_NOT_FOUND');
});

test('returns 404 for unknown capability', async () => {
  const action = createWorkspaceCapabilityCatalogAction({
    fetchCapabilities: async () => rows.filter((row) => row.capability_key === 'postgres-database')
  });
  const response = await action({ workspaceId: 'ws-123', capabilityId: 'unknown-capability', auth: { claims: baseClaims } });
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error.code, 'CAPABILITY_NOT_FOUND');
});

test('returns full catalog for valid request', async () => {
  const action = createWorkspaceCapabilityCatalogAction({ fetchCapabilities: async () => rows });
  const response = await action({ workspaceId: 'ws-123', auth: { claims: baseClaims } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.capabilities.length, 6);
});

test('returns single-capability catalog for valid request', async () => {
  const action = createWorkspaceCapabilityCatalogAction({
    fetchCapabilities: async ({ capabilityId }) => rows.filter((row) => row.capability_key === capabilityId)
  });
  const response = await action({ workspaceId: 'ws-123', capabilityId: 'postgres-database', auth: { claims: baseClaims } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.capabilities.length, 1);
});

test('Kafka publish failure does not fail the request', async () => {
  const warnings = [];
  const action = createWorkspaceCapabilityCatalogAction({
    fetchCapabilities: async () => rows,
    emitAuditEvent: async () => {
      throw new Error('kafka offline');
    },
    logger: {
      warn: (payload, message) => warnings.push({ payload, message })
    }
  });

  const response = await action({ workspaceId: 'ws-123', auth: { claims: baseClaims } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(response.statusCode, 200);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].message, 'audit-publish-failed');
});
