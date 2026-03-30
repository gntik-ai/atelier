import { randomUUID } from 'node:crypto';
import { loadEnv } from '../config/env.mjs';
import { validateToken } from './token-validator.mjs';
import { checkScopes } from './scope-checker.mjs';
import { publishAuthDecision } from '../audit/audit-publisher.mjs';

export function createSessionManager({
  envProvider = loadEnv,
  validateTokenFn = validateToken,
  checkScopesFn = checkScopes,
  introspectTokenFn = async () => ({ active: true, scopes: [] }),
  publishAuthDecisionFn = publishAuthDecision,
  logger = console,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  nowFn = () => Date.now()
} = {}) {
  const activeSessions = new Map();

  async function insertSessionRow(db, session) {
    await db.query(
      `INSERT INTO realtime_sessions (
          id,
          tenant_id,
          workspace_id,
          actor_identity,
          token_jti,
          token_expires_at,
          status,
          last_validated_at,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $8)`,
      [
        session.id,
        session.tenantId,
        session.workspaceId,
        session.actorIdentity,
        session.tokenJti,
        session.tokenExpiresAt,
        session.status,
        session.lastValidatedAt
      ]
    );
  }

  async function updateSessionStatus(db, session, status) {
    const timestamp = new Date(nowFn()).toISOString();
    session.status = status;
    session.lastValidatedAt = timestamp;

    await db.query(
      `UPDATE realtime_sessions
          SET status = $2,
              last_validated_at = $3,
              updated_at = $3
        WHERE id = $1`,
      [session.id, status, timestamp]
    );
  }

  async function suspendSession(db, session, reason) {
    if (session.status === 'SUSPENDED' || session.status === 'CLOSED') {
      return;
    }

    await updateSessionStatus(db, session, 'SUSPENDED');
    await publishAuthDecisionFn({
      action: 'SUSPENDED',
      tenantId: session.tenantId,
      workspaceId: session.workspaceId,
      actorIdentity: session.actorIdentity,
      subscriptionId: session.id,
      channelType: session.channelType,
      scopesEvaluated: session.claims.scopes,
      suspensionReason: reason,
      timestamp: new Date(nowFn()).toISOString()
    }, {
      kafka: session.kafka,
      db
    });
  }

  function clearSessionTimer(session) {
    if (session.intervalId) {
      clearIntervalFn(session.intervalId);
      session.intervalId = null;
    }
  }

  function startPolling(db, session) {
    const env = envProvider();
    const intervalMs = env.SCOPE_REVALIDATION_INTERVAL_SECONDS * 1000;
    const graceMs = env.TOKEN_EXPIRY_GRACE_SECONDS * 1000;

    session.intervalId = setIntervalFn(async () => {
      try {
        if (session.status === 'CLOSED') {
          clearSessionTimer(session);
          return;
        }

        const now = nowFn();

        if (now >= new Date(session.tokenExpiresAt).getTime() + graceMs) {
          await suspendSession(db, session, 'TOKEN_EXPIRED');
          return;
        }

        const introspection = await introspectTokenFn(session.token);

        if (!introspection?.active) {
          await suspendSession(db, session, now >= new Date(session.tokenExpiresAt).getTime() ? 'TOKEN_EXPIRED' : 'SCOPE_REVOKED');
          return;
        }

        const introspectedScopes = Array.isArray(introspection.scopes)
          ? introspection.scopes
          : String(introspection.scope ?? '').split(/\s+/).filter(Boolean);
        const scopeCheck = await checkScopesFn({
          ...session.claims,
          scopes: introspectedScopes,
          authorizedWorkspaces: introspection.authorizedWorkspaces ?? session.claims.authorizedWorkspaces
        }, session.workspaceId, session.channelType, db);

        if (!scopeCheck.allowed) {
          await suspendSession(db, session, 'SCOPE_REVOKED');
          return;
        }

        session.lastValidatedAt = new Date(now).toISOString();
        await db.query(
          `UPDATE realtime_sessions
              SET last_validated_at = $2,
                  updated_at = $2
            WHERE id = $1`,
          [session.id, session.lastValidatedAt]
        );
      } catch (error) {
        logger.error?.('Session polling failed.', error);
      }
    }, intervalMs);
  }

  async function createSession(bearerToken, workspaceId, channelType, db, { kafka } = {}) {
    const claims = await validateTokenFn(bearerToken);
    const scopeCheck = await checkScopesFn(claims, workspaceId, channelType, db);

    if (!scopeCheck.allowed) {
      const error = new Error(scopeCheck.missingScope ?? 'Scope denied');
      error.code = 'INSUFFICIENT_SCOPE';
      throw error;
    }

    const timestamp = new Date(nowFn()).toISOString();
    const session = {
      id: randomUUID(),
      tenantId: claims.tenant_id,
      workspaceId,
      actorIdentity: claims.sub,
      tokenJti: claims.jti,
      tokenExpiresAt: new Date(claims.exp * 1000).toISOString(),
      lastValidatedAt: timestamp,
      status: 'ACTIVE',
      channelType,
      claims,
      token: bearerToken,
      kafka
    };

    await insertSessionRow(db, session);
    activeSessions.set(session.id, session);
    startPolling(db, session);

    return {
      id: session.id,
      tenantId: session.tenantId,
      workspaceId: session.workspaceId,
      actorIdentity: session.actorIdentity,
      tokenJti: session.tokenJti,
      status: session.status
    };
  }

  async function refreshToken(sessionId, newBearerToken, db, { kafka } = {}) {
    const session = activeSessions.get(sessionId);

    if (!session) {
      throw new Error(`Unknown session ${sessionId}`);
    }

    const priorStatus = session.status;
    const claims = await validateTokenFn(newBearerToken);
    session.claims = claims;
    session.token = newBearerToken;
    session.tokenJti = claims.jti;
    session.tokenExpiresAt = new Date(claims.exp * 1000).toISOString();
    session.status = 'ACTIVE';
    session.kafka = kafka ?? session.kafka;
    session.lastValidatedAt = new Date(nowFn()).toISOString();

    await db.query(
      `UPDATE realtime_sessions
          SET token_jti = $2,
              token_expires_at = $3,
              last_validated_at = $4,
              status = 'ACTIVE',
              updated_at = $4
        WHERE id = $1`,
      [session.id, session.tokenJti, session.tokenExpiresAt, session.lastValidatedAt]
    );

    clearSessionTimer(session);
    startPolling(db, session);

    if (priorStatus === 'SUSPENDED') {
      await publishAuthDecisionFn({
        action: 'RESUMED',
        tenantId: session.tenantId,
        workspaceId: session.workspaceId,
        actorIdentity: session.actorIdentity,
        subscriptionId: session.id,
        channelType: session.channelType,
        scopesEvaluated: claims.scopes,
        resumedAt: new Date(nowFn()).toISOString(),
        timestamp: new Date(nowFn()).toISOString()
      }, {
        kafka: session.kafka,
        db
      });
    }
  }

  async function closeSession(sessionId, db) {
    const session = activeSessions.get(sessionId);

    if (!session) {
      return;
    }

    clearSessionTimer(session);
    await updateSessionStatus(db, session, 'CLOSED');
    activeSessions.delete(sessionId);
  }

  function shutdown() {
    for (const session of activeSessions.values()) {
      clearSessionTimer(session);
      session.status = 'CLOSED';
    }

    activeSessions.clear();
  }

  return {
    createSession,
    refreshToken,
    closeSession,
    shutdown,
    _activeSessions: activeSessions
  };
}
