import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorkspaceCapabilityCatalogAction } from '../../services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs';

const baseClaims = {
  workspaceId: 'ws-123',
  tenantId: 'ten-123',
  actorId: 'user-123'
};

const enabledRows = [
  { capability_key: 'postgres-database', display_name: 'PostgreSQL', category: 'data', description: 'Relational database', enabled: true, status: 'active', dependencies: [] },
  { capability_key: 'mongo-collection', display_name: 'MongoDB', category: 'data', description: 'Document database', enabled: false, status: 'disabled', dependencies: [] },
  { capability_key: 'kafka-events', display_name: 'Event Streaming', category: 'messaging', description: 'Kafka-based event bus', enabled: true, status: 'active', dependencies: [] },
  { capability_key: 'realtime-subscription', display_name: 'Realtime Subscriptions', category: 'messaging', description: 'Realtime delivery', enabled: true, status: 'active', dependencies: ['kafka-events'] },
  { capability_key: 'serverless-function', display_name: 'Serverless Functions', category: 'compute', description: 'Functions', enabled: true, status: 'active', dependencies: [] },
  { capability_key: 'storage-bucket', display_name: 'Object Storage', category: 'storage', description: 'Object storage', enabled: true, status: 'active', dependencies: [] }
];

test('full catalog returns enabled and disabled capability mix', async () => {
  const action = createWorkspaceCapabilityCatalogAction({ fetchCapabilities: async () => enabledRows });
  const response = await action({ workspaceId: 'ws-123', auth: { claims: baseClaims } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.capabilities.find((item) => item.id === 'postgres-database').enabled, true);
  assert.equal(response.body.capabilities.find((item) => item.id === 'realtime-subscription').enabled, true);
  assert.equal(response.body.capabilities.find((item) => item.id === 'mongo-collection').enabled, false);
});

test('disabled capability returns empty examples and enablement guide', async () => {
  const action = createWorkspaceCapabilityCatalogAction({ fetchCapabilities: async () => enabledRows });
  const response = await action({ workspaceId: 'ws-123', auth: { claims: baseClaims } });
  const mongo = response.body.capabilities.find((item) => item.id === 'mongo-collection');
  assert.equal(mongo.examples.length, 0);
  assert.match(mongo.enablementGuide, /MongoDB/);
});

test('transitional state is surfaced in catalog response', async () => {
  const action = createWorkspaceCapabilityCatalogAction({
    fetchCapabilities: async () => enabledRows.map((row) => row.capability_key === 'postgres-database' ? { ...row, status: 'provisioning' } : row)
  });
  const response = await action({ workspaceId: 'ws-123', auth: { claims: baseClaims } });
  assert.equal(response.body.capabilities.find((item) => item.id === 'postgres-database').status, 'provisioning');
});

test('single-capability request returns one item with examples', async () => {
  const action = createWorkspaceCapabilityCatalogAction({
    fetchCapabilities: async ({ capabilityId }) => enabledRows.filter((row) => row.capability_key === capabilityId)
  });
  const response = await action({ workspaceId: 'ws-123', capabilityId: 'postgres-database', auth: { claims: baseClaims } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.capabilities.length, 1);
  assert.ok(response.body.capabilities[0].examples.length >= 3);
});

test('audit event is emitted to the expected topic payload surface', async () => {
  const events = [];
  const action = createWorkspaceCapabilityCatalogAction({
    fetchCapabilities: async () => enabledRows,
    emitAuditEvent: async (event) => {
      events.push(event);
    }
  });

  await action({ workspaceId: 'ws-123', auth: { claims: baseClaims } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'workspace.capability-catalog.accessed');
});

test('migration file contains idempotent DDL markers', () => {
  const sql = readFileSync(new URL('../../services/provisioning-orchestrator/src/migrations/090-workspace-capability-catalog.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS capability_catalog_metadata/);
  assert.match(sql, /ON CONFLICT \(capability_key\) DO NOTHING/);
});
