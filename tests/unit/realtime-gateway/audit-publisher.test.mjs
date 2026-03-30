import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditPublisher } from '../../../services/realtime-gateway/src/audit/audit-publisher.mjs';
import { insertAuthRecord } from '../../../services/realtime-gateway/src/repositories/auth-record-repository.mjs';

const env = () => ({
  KEYCLOAK_JWKS_URL: 'https://keycloak.example/certs',
  KEYCLOAK_INTROSPECTION_URL: 'https://keycloak.example/introspect',
  KEYCLOAK_INTROSPECTION_CLIENT_ID: 'client-id',
  KEYCLOAK_INTROSPECTION_CLIENT_SECRET: 'client-secret',
  DATABASE_URL: 'postgres://example',
  KAFKA_BROKERS: ['broker:9092'],
  JWKS_CACHE_TTL_SECONDS: 300,
  SCOPE_REVALIDATION_INTERVAL_SECONDS: 30,
  TOKEN_EXPIRY_GRACE_SECONDS: 30,
  MAX_FILTER_PREDICATES: 10,
  MAX_SUBSCRIPTIONS_PER_WORKSPACE: 50,
  AUDIT_KAFKA_TOPIC_AUTH_GRANTED: 'granted-topic',
  AUDIT_KAFKA_TOPIC_AUTH_DENIED: 'denied-topic',
  AUDIT_KAFKA_TOPIC_SESSION_SUSPENDED: 'suspended-topic',
  AUDIT_KAFKA_TOPIC_SESSION_RESUMED: 'resumed-topic',
  REALTIME_AUTH_ENABLED: true
});

function createKafka() {
  const sent = [];
  return {
    sent,
    producer: {
      send: async (payload) => {
        sent.push(payload);
      }
    }
  };
}

function createDecision(action, extras = {}) {
  return {
    action,
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    actorIdentity: 'user-1',
    subscriptionId: 'subscription-1',
    channelType: 'postgresql-changes',
    scopesEvaluated: ['realtime:read'],
    timestamp: '2026-03-30T12:00:00.000Z',
    ...extras
  };
}

test('publishAuthDecision routes each action to the correct Kafka topic', async () => {
  const records = [];
  const publisher = createAuditPublisher({
    envProvider: env,
    insertAuthRecordFn: async (_db, record) => {
      records.push(record);
    }
  });

  const kafka = createKafka();
  const db = {};

  await publisher(createDecision('GRANTED'), { kafka, db });
  await publisher(createDecision('DENIED', { denialReason: 'INSUFFICIENT_SCOPE' }), { kafka, db });
  await publisher(createDecision('SUSPENDED', { suspensionReason: 'SCOPE_REVOKED' }), { kafka, db });
  await publisher(createDecision('RESUMED', { resumedAt: '2026-03-30T12:00:01.000Z' }), { kafka, db });

  assert.deepEqual(kafka.sent.map((entry) => entry.topic), [
    'granted-topic',
    'denied-topic',
    'suspended-topic',
    'resumed-topic'
  ]);
  assert.equal(records.length, 4);
});

test('publishAuthDecision logs PostgreSQL failures without aborting Kafka publish', async () => {
  const logged = [];
  const publisher = createAuditPublisher({
    envProvider: env,
    insertAuthRecordFn: async () => {
      throw new Error('db unavailable');
    },
    logger: {
      error: (...args) => logged.push(args)
    }
  });

  const kafka = createKafka();
  await publisher(createDecision('DENIED', { denialReason: 'INSUFFICIENT_SCOPE' }), { kafka, db: {} });

  assert.equal(kafka.sent.length, 1);
  assert.equal(logged.length, 1);
});

test('auth record repository remains insert-only and writes tenant_id', async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    }
  };

  await insertAuthRecord(db, {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    actorIdentity: 'user-1',
    subscriptionId: 'subscription-1',
    channelType: 'postgresql-changes',
    action: 'DENIED',
    denialReason: 'INSUFFICIENT_SCOPE',
    scopesEvaluated: ['realtime:read'],
    filterSnapshot: { passAll: true },
    timestamp: '2026-03-30T12:00:00.000Z'
  });

  assert.match(calls[0].sql, /^INSERT INTO realtime_subscription_auth_records/);
  assert.equal(calls[0].params[0], 'tenant-1');
});
