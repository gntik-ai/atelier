import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import responseSchema from '../../services/internal-contracts/src/workspace-capability-catalog-response.json' with { type: 'json' };
import eventSchema from '../../services/internal-contracts/src/workspace-capability-catalog-accessed-event.json' with { type: 'json' };
import { buildCatalog } from '../../services/workspace-docs-service/src/capability-catalog-builder.mjs';

const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });

const validateResponse = ajv.compile(responseSchema);
const validateEvent = ajv.compile(eventSchema);

const fixtureRows = [
  { capability_key: 'postgres-database', display_name: 'PostgreSQL', category: 'data', description: 'Relational database', enabled: true, status: 'active', dependencies: [] },
  { capability_key: 'mongo-collection', display_name: 'MongoDB', category: 'data', description: 'Document database', enabled: false, status: 'disabled', dependencies: [] },
  { capability_key: 'kafka-events', display_name: 'Event Streaming', category: 'messaging', description: 'Kafka-based event bus', enabled: true, status: 'active', dependencies: [] },
  { capability_key: 'realtime-subscription', display_name: 'Realtime Subscriptions', category: 'messaging', description: 'Realtime delivery', enabled: true, status: 'active', dependencies: ['kafka-events'] },
  { capability_key: 'serverless-function', display_name: 'Serverless Functions', category: 'compute', description: 'Functions', enabled: true, status: 'active', dependencies: [] },
  { capability_key: 'storage-bucket', display_name: 'Object Storage', category: 'storage', description: 'Object storage', enabled: true, status: 'active', dependencies: [] }
];

const workspaceContext = {
  workspaceId: 'ws-123',
  tenantId: 'ten-123',
  host: 'catalog.example.internal',
  port: 9092,
  resourceNames: {
    default: 'workspace-primary',
    extraA: 'workspace-mongo',
    extraB: 'https://functions.example.internal/api/v1/web/ws-123/default/ping'
  },
  endpoints: {
    realtime: 'wss://realtime.example.internal'
  }
};

const fullCatalogFixture = {
  workspaceId: 'ws-123',
  tenantId: 'ten-123',
  generatedAt: '2026-03-30T20:00:00.000Z',
  catalogVersion: '1.0.0',
  capabilities: buildCatalog(fixtureRows, workspaceContext)
};

const singleCapabilityFixture = {
  ...fullCatalogFixture,
  capabilities: fullCatalogFixture.capabilities.filter((capability) => capability.id === 'postgres-database')
};

const auditEventFixture = {
  eventType: 'workspace.capability-catalog.accessed',
  workspaceId: 'ws-123',
  tenantId: 'ten-123',
  actorId: 'user-123',
  capabilityId: null,
  accessDate: '2026-03-30',
  correlationId: 'corr-123',
  timestamp: '2026-03-30T20:00:00.000Z'
};

test('full catalog fixture validates against response schema', () => {
  assert.equal(validateResponse(fullCatalogFixture), true, JSON.stringify(validateResponse.errors));
});

test('single capability fixture validates against response schema', () => {
  assert.equal(validateResponse(singleCapabilityFixture), true, JSON.stringify(validateResponse.errors));
});

test('audit event fixture validates against event schema', () => {
  assert.equal(validateEvent(auditEventFixture), true, JSON.stringify(validateEvent.errors));
});

test('full catalog contains all 6 capability keys', () => {
  const ids = fullCatalogFixture.capabilities.map((capability) => capability.id).sort();
  assert.deepEqual(ids, ['kafka-events', 'mongo-collection', 'postgres-database', 'realtime-subscription', 'serverless-function', 'storage-bucket']);
});

test('enabled capabilities include at least 3 examples', () => {
  for (const capability of fullCatalogFixture.capabilities.filter((item) => item.enabled)) {
    assert.ok(capability.examples.length >= 3, capability.id);
  }
});

test('disabled capabilities include empty examples and enablement guide', () => {
  for (const capability of fullCatalogFixture.capabilities.filter((item) => !item.enabled)) {
    assert.equal(capability.examples.length, 0);
    assert.ok(capability.enablementGuide.length > 0);
  }
});
