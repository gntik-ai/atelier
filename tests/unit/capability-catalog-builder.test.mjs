import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, buildExamples } from '../../services/workspace-docs-service/src/capability-catalog-builder.mjs';

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

test('buildExamples returns resolved examples for enabled postgres', () => {
  const examples = buildExamples('postgres-database', true, workspaceContext);
  assert.ok(examples.length >= 3);
  for (const example of examples) {
    assert.equal(example.code.includes('{HOST}'), false);
    assert.equal(example.code.includes('{PORT}'), false);
  }
});

test('buildExamples returns empty array for disabled mongo', () => {
  const examples = buildExamples('mongo-collection', false, workspaceContext);
  assert.deepEqual(examples, []);
});

test('buildCatalog attaches enablementGuide for disabled capability', () => {
  const [item] = buildCatalog([
    {
      capability_key: 'mongo-collection',
      display_name: 'MongoDB',
      category: 'data',
      description: 'Document database',
      enabled: false,
      status: 'disabled',
      dependencies: []
    }
  ], workspaceContext);

  assert.equal(item.examples.length, 0);
  assert.match(item.enablementGuide, /MongoDB/);
});

test('buildCatalog includes dependency note for realtime subscriptions', () => {
  const [item] = buildCatalog([
    {
      capability_key: 'realtime-subscription',
      display_name: 'Realtime Subscriptions',
      category: 'messaging',
      description: 'Realtime delivery',
      enabled: true,
      status: 'active',
      dependencies: ['kafka-events']
    }
  ], workspaceContext);

  assert.match(item.dependencyNote, /kafka-events/);
});

test('buildCatalog maps transitional provisioning status', () => {
  const [item] = buildCatalog([
    {
      capability_key: 'postgres-database',
      display_name: 'PostgreSQL',
      category: 'data',
      description: 'Relational database',
      enabled: true,
      status: 'provisioning',
      dependencies: []
    }
  ], workspaceContext);

  assert.equal(item.status, 'provisioning');
});
