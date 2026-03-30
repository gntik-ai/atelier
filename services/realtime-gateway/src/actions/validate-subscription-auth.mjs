import { loadEnv } from '../config/env.mjs';
import { AuthError, validateToken } from '../auth/token-validator.mjs';
import { checkScopes } from '../auth/scope-checker.mjs';
import { parseFilter, FilterValidationError } from '../filters/filter-parser.mjs';
import { checkComplexity } from '../filters/complexity-checker.mjs';
import { publishAuthDecision } from '../audit/audit-publisher.mjs';

async function countActiveSubscriptions(db, tenantId, workspaceId, actorIdentity) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM realtime_sessions
      WHERE tenant_id = $1
        AND workspace_id = $2
        AND actor_identity = $3
        AND status = 'ACTIVE'`,
    [tenantId, workspaceId, actorIdentity]
  );

  return result.rows[0]?.count ?? 0;
}

export function createValidateSubscriptionAuthAction({
  envProvider = loadEnv,
  validateTokenFn = validateToken,
  checkScopesFn = checkScopes,
  parseFilterFn = parseFilter,
  checkComplexityFn = checkComplexity,
  publishAuthDecisionFn = publishAuthDecision,
  logger = console
} = {}) {
  return async function main(params, { db, kafka } = {}) {
    const env = envProvider();

    if (!env.REALTIME_AUTH_ENABLED) {
      logger.warn?.({ reason: 'AUTH_BYPASSED' }, 'Realtime auth bypassed by feature flag.');
      return { allowed: true, subscriptionContext: {} };
    }

    const { token, workspaceId, channelType, filter } = params;
    let claims;

    try {
      claims = await validateTokenFn(token);
    } catch (error) {
      const authError = error instanceof AuthError ? error : new AuthError('TOKEN_INVALID', error.message);
      await publishAuthDecisionFn({
        action: 'DENIED',
        tenantId: 'unknown',
        workspaceId,
        actorIdentity: 'unknown',
        channelType,
        scopesEvaluated: [],
        denialReason: authError.code,
        timestamp: new Date().toISOString()
      }, { kafka, db });
      return { allowed: false, error: { code: authError.code, message: authError.message } };
    }

    const scopeCheck = await checkScopesFn(claims, workspaceId, channelType, db);

    if (!scopeCheck.allowed) {
      await publishAuthDecisionFn({
        action: 'DENIED',
        tenantId: claims.tenant_id,
        workspaceId,
        actorIdentity: claims.sub,
        channelType,
        scopesEvaluated: claims.scopes,
        denialReason: 'INSUFFICIENT_SCOPE',
        missingScope: scopeCheck.missingScope,
        timestamp: new Date().toISOString()
      }, { kafka, db });
      return {
        allowed: false,
        error: {
          code: 'INSUFFICIENT_SCOPE',
          missingScope: scopeCheck.missingScope,
          message: `Missing required scope ${scopeCheck.missingScope}`
        }
      };
    }

    let filterSpec;

    try {
      filterSpec = parseFilterFn(filter);
      checkComplexityFn(filterSpec, env.MAX_FILTER_PREDICATES);
    } catch (error) {
      if (!(error instanceof FilterValidationError)) {
        throw error;
      }

      await publishAuthDecisionFn({
        action: 'DENIED',
        tenantId: claims.tenant_id,
        workspaceId,
        actorIdentity: claims.sub,
        channelType,
        scopesEvaluated: claims.scopes,
        filterSnapshot: filter,
        denialReason: 'INVALID_FILTER',
        timestamp: new Date().toISOString()
      }, { kafka, db });
      return {
        allowed: false,
        error: {
          code: 'INVALID_FILTER',
          validationErrors: error.validationErrors,
          message: error.message
        }
      };
    }

    const activeSubscriptionCount = await countActiveSubscriptions(db, claims.tenant_id, workspaceId, claims.sub);

    if (activeSubscriptionCount >= env.MAX_SUBSCRIPTIONS_PER_WORKSPACE) {
      await publishAuthDecisionFn({
        action: 'DENIED',
        tenantId: claims.tenant_id,
        workspaceId,
        actorIdentity: claims.sub,
        channelType,
        scopesEvaluated: claims.scopes,
        filterSnapshot: filterSpec,
        denialReason: 'QUOTA_EXCEEDED',
        timestamp: new Date().toISOString()
      }, { kafka, db });
      return {
        allowed: false,
        error: {
          code: 'QUOTA_EXCEEDED',
          message: 'Maximum number of subscriptions reached.'
        }
      };
    }

    await publishAuthDecisionFn({
      action: 'GRANTED',
      tenantId: claims.tenant_id,
      workspaceId,
      actorIdentity: claims.sub,
      channelType,
      scopesEvaluated: claims.scopes,
      filterSnapshot: filterSpec,
      timestamp: new Date().toISOString()
    }, { kafka, db });

    return {
      allowed: true,
      subscriptionContext: {
        tenantId: claims.tenant_id,
        workspaceId,
        actorIdentity: claims.sub,
        channelType,
        filterSpec
      }
    };
  };
}

export const main = createValidateSubscriptionAuthAction();
