import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthError } from '../../../services/realtime-gateway/src/auth/token-validator.mjs';
import { createScopeChecker } from '../../../services/realtime-gateway/src/auth/scope-checker.mjs';
import { createAuditPublisher } from '../../../services/realtime-gateway/src/audit/audit-publisher.mjs';
import { createSessionManager } from '../../../services/realtime-gateway/src/auth/session-manager.mjs';
import { createValidateSubscriptionAuthAction } from '../../../services/realtime-gateway/src/actions/validate-subscription-auth.mjs';
import { createHandleScopeRevocationAction } from '../../../services/realtime-gateway/src/actions/handle-scope-revocation.mjs';
import { guardEvent } from '../../../services/realtime-gateway/src/isolation/tenant-workspace-guard.mjs';

function createState() {
  return {
    sessions: [],
    authRecords: [],
    scopeMappings: []
  };
}

function createDb(state) {
  return {
    async query(sql, params) {
      if (/INSERT INTO realtime_sessions/.test(sql)) {
        state.sessions.push({
          id: params[0],
          tenant_id: params[1],
          workspace_id: params[2],
          actor_identity: params[3],
          token_jti: params[4],
          token_expires_at: params[5],
          status: params[6],
          last_validated_at: params[7],
          channel_type: 'postgresql-changes'
        });
        return { rows: [] };
      }

      if (/UPDATE realtime_sessions\s+SET status = \$2/.test(sql)) {
        const session = state.sessions.find((item) => item.id === params[0]);
        if (session) {
          session.status = params[1];
          session.last_validated_at = params[2];
        }
        return { rows: [] };
      }

      if (/UPDATE realtime_sessions\s+SET token_jti = \$2/.test(sql)) {
        const session = state.sessions.find((item) => item.id === params[0]);
        if (session) {
          session.token_jti = params[1];
          session.token_expires_at = params[2];
          session.last_validated_at = params[3];
          session.status = 'ACTIVE';
        }
        return { rows: [] };
      }

      if (/UPDATE realtime_sessions\s+SET last_validated_at = \$2/.test(sql)) {
        const session = state.sessions.find((item) => item.id === params[0]);
        if (session) {
          session.last_validated_at = params[1];
        }
        return { rows: [] };
      }

      if (/UPDATE realtime_sessions\s+SET status = 'SUSPENDED'/.test(sql)) {
        const session = state.sessions.find((item) => item.id === params[0]);
        if (session) {
          session.status = 'SUSPENDED';
          session.last_validated_at = params[1];
        }
        return { rows: [] };
      }

      if (/SELECT COUNT\(\*\)::int AS count\s+FROM realtime_sessions/.test(sql)) {
        const count = state.sessions.filter((session) => (
          session.tenant_id === params[0]
          && session.workspace_id === params[1]
          && session.actor_identity === params[2]
          && session.status === 'ACTIVE'
        )).length;
        return { rows: [{ count }] };
      }

      if (/SELECT id, tenant_id, workspace_id, actor_identity, channel_type\s+FROM realtime_sessions/.test(sql)) {
        return {
          rows: state.sessions.filter((session) => (
            session.actor_identity === params[0]
            && session.tenant_id === params[1]
            && session.status === 'ACTIVE'
          ))
        };
      }

      return { rows: [] };
    }
  };
}

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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('subscription auth flow covers grant, deny, expiry suspension, resume, revocation, and audit persistence', async () => {
  const state = createState();
  const db = createDb(state);
  const kafka = createKafka();
  const log = [];
  let nowMs = Date.parse('2026-03-30T12:00:00.000Z');
  let introspectionResponse = { active: true, scope: 'realtime:read', authorizedWorkspaces: ['workspace-1'] };
  let clearCalls = 0;

  const env = () => ({
    KEYCLOAK_JWKS_URL: 'https://keycloak.example/certs',
    KEYCLOAK_INTROSPECTION_URL: 'https://keycloak.example/introspect',
    KEYCLOAK_INTROSPECTION_CLIENT_ID: 'client-id',
    KEYCLOAK_INTROSPECTION_CLIENT_SECRET: 'client-secret',
    DATABASE_URL: 'postgres://example',
    KAFKA_BROKERS: ['broker:9092'],
    JWKS_CACHE_TTL_SECONDS: 300,
    SCOPE_REVALIDATION_INTERVAL_SECONDS: 30,
    TOKEN_EXPIRY_GRACE_SECONDS: 0,
    MAX_FILTER_PREDICATES: 10,
    MAX_SUBSCRIPTIONS_PER_WORKSPACE: 50,
    AUDIT_KAFKA_TOPIC_AUTH_GRANTED: 'granted-topic',
    AUDIT_KAFKA_TOPIC_AUTH_DENIED: 'denied-topic',
    AUDIT_KAFKA_TOPIC_SESSION_SUSPENDED: 'suspended-topic',
    AUDIT_KAFKA_TOPIC_SESSION_RESUMED: 'resumed-topic',
    REALTIME_AUTH_ENABLED: true
  });

  const claimsByToken = {
    'valid-token': {
      sub: 'user-1',
      tenant_id: 'tenant-1',
      scopes: ['realtime:read'],
      authorizedWorkspaces: ['workspace-1'],
      exp: Math.floor((nowMs + 1_000) / 1000),
      jti: 'jti-1'
    },
    'refreshed-token': {
      sub: 'user-1',
      tenant_id: 'tenant-1',
      scopes: ['realtime:read'],
      authorizedWorkspaces: ['workspace-1'],
      exp: Math.floor((nowMs + 60_000) / 1000),
      jti: 'jti-2'
    },
    'missing-scope-token': {
      sub: 'user-1',
      tenant_id: 'tenant-1',
      scopes: ['workspace:read'],
      authorizedWorkspaces: ['workspace-1'],
      exp: Math.floor((nowMs + 60_000) / 1000),
      jti: 'jti-3'
    }
  };

  const validateTokenFn = async (token) => {
    if (token === 'expired-token') {
      throw new AuthError('TOKEN_EXPIRED', 'Token has expired.');
    }

    return claimsByToken[token];
  };

  const scopeChecker = createScopeChecker({
    envProvider: env,
    getScopeMappingsFn: async (_db, tenantId, workspaceId) => state.scopeMappings.filter((row) => row.tenant_id === tenantId && row.workspace_id === workspaceId)
  });

  const auditPublisher = createAuditPublisher({
    envProvider: env,
    insertAuthRecordFn: async (_db, record) => {
      state.authRecords.push(record);
    },
    logger: {
      error: (...args) => log.push(args)
    }
  });

  const validateSubscriptionAuth = createValidateSubscriptionAuthAction({
    envProvider: env,
    validateTokenFn,
    checkScopesFn: scopeChecker,
    publishAuthDecisionFn: auditPublisher,
    logger: {
      warn: (...args) => log.push(args)
    }
  });

  const sessionManager = createSessionManager({
    envProvider: env,
    validateTokenFn,
    checkScopesFn: scopeChecker,
    introspectTokenFn: async () => introspectionResponse,
    publishAuthDecisionFn: auditPublisher,
    setIntervalFn: (fn) => setInterval(fn, 10),
    clearIntervalFn: (id) => {
      clearCalls += 1;
      clearInterval(id);
    },
    nowFn: () => nowMs,
    logger: {
      error: (...args) => log.push(args)
    }
  });

  const revokeScopes = createHandleScopeRevocationAction({
    publishAuthDecisionFn: auditPublisher,
    nowFn: () => new Date(nowMs).toISOString()
  });

  const grantResult = await validateSubscriptionAuth({
    token: 'valid-token',
    workspaceId: 'workspace-1',
    channelType: 'postgresql-changes',
    filter: { operation: 'INSERT', entity: 'orders' }
  }, { db, kafka });

  assert.equal(grantResult.allowed, true);
  assert.equal(state.authRecords.at(-1).action, 'GRANTED');

  const denyResult = await validateSubscriptionAuth({
    token: 'missing-scope-token',
    workspaceId: 'workspace-1',
    channelType: 'postgresql-changes',
    filter: null
  }, { db, kafka });

  assert.equal(denyResult.allowed, false);
  assert.equal(denyResult.error.code, 'INSUFFICIENT_SCOPE');
  assert.equal(state.authRecords.at(-1).action, 'DENIED');
  assert.equal(state.authRecords.at(-1).denialReason, 'INSUFFICIENT_SCOPE');

  const expiredResult = await validateSubscriptionAuth({
    token: 'expired-token',
    workspaceId: 'workspace-1',
    channelType: 'postgresql-changes',
    filter: null
  }, { db, kafka });

  assert.equal(expiredResult.allowed, false);
  assert.equal(expiredResult.error.code, 'TOKEN_EXPIRED');

  const session = await sessionManager.createSession('valid-token', 'workspace-1', 'postgresql-changes', db, { kafka });
  assert.equal(session.status, 'ACTIVE');

  assert.equal(guardEvent({ tenantId: 'tenant-2', workspaceId: 'workspace-1' }, { tenantId: 'tenant-1', workspaceId: 'workspace-1' }), false);
  assert.equal(guardEvent({ tenantId: 'tenant-1', workspaceId: 'workspace-2' }, { tenantId: 'tenant-1', workspaceId: 'workspace-1' }), false);

  nowMs += 2_000;
  await wait(30);
  assert.equal(state.sessions.find((item) => item.id === session.id)?.status, 'SUSPENDED');
  assert.equal(state.authRecords.at(-1).action, 'SUSPENDED');
  assert.equal(state.authRecords.at(-1).suspensionReason, 'TOKEN_EXPIRED');

  claimsByToken['refreshed-token'].exp = Math.floor((nowMs + 60_000) / 1000);
  await sessionManager.refreshToken(session.id, 'refreshed-token', db, { kafka });
  assert.equal(state.sessions.find((item) => item.id === session.id)?.status, 'ACTIVE');
  assert.equal(state.authRecords.at(-1).action, 'RESUMED');

  introspectionResponse = { active: false };
  const revocationResult = await revokeScopes({ actorIdentity: 'user-1', revokedScopes: ['realtime:read'], tenantId: 'tenant-1' }, { db, kafka });
  assert.equal(revocationResult.suspendedCount, 1);
  assert.equal(state.sessions.find((item) => item.id === session.id)?.status, 'SUSPENDED');
  assert.equal(state.authRecords.at(-1).suspensionReason, 'SCOPE_REVOKED');

  assert.ok(state.authRecords.length >= 5);

  await sessionManager.closeSession(session.id, db);
  sessionManager.shutdown();
  assert.ok(clearCalls >= 1);
});
