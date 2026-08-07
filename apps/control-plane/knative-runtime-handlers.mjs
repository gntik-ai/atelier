import { randomUUID } from 'node:crypto';
import { publicKnativeStatus } from './knative-runtime.mjs';

// Platform roles allowed to READ the runtime status route (GET /v1/platform/runtime/knative). This
// set is the backend twin of the web console's platform-observer route guard
// (apps/web-console/src/router.tsx `isPlatformObserverRole`): superadmin plus the three platform_*
// roles. Authorization is by verified platform ROLE only — a token that merely asserts
// actor_type=superadmin but carries none of these roles is NOT a runtime observer, so the backend
// gate matches exactly what the console shows and no role-less principal can read operator status.
export const KNATIVE_STATUS_OBSERVER_ROLES = Object.freeze([
  'superadmin', 'platform_admin', 'platform_operator', 'platform_auditor',
]);

// True when the verified identity carries at least one platform-observer role. Role-only and
// fail-closed: a missing identity, absent/blank roles, or a non-array roles claim is never an
// observer. Deliberately ignores actor_type so the backend cannot out-grant the UI.
export function isKnativeStatusObserver(identity) {
  const roles = identity?.roles;
  return Array.isArray(roles) && roles.some((role) => KNATIVE_STATUS_OBSERVER_ROLES.includes(role));
}

const PUBLIC_CORRELATION_ID = /^[A-Za-z0-9._:-]{8,128}$/;

function boundedCorrelationId(value) {
  const candidate = typeof value === 'string' ? value : '';
  return PUBLIC_CORRELATION_ID.test(candidate) ? candidate : randomUUID();
}

// The status route is implemented by this local control-plane rather than the gateway error
// serializer. Keep its authentication envelopes route-specific and exactly aligned with the public
// schemas without changing the unrelated global ErrorResponse contract.
export function knativeRuntimeAuthenticationError(code, correlationId) {
  const invalidToken = code === 'INVALID_TOKEN';
  return {
    code: invalidToken ? 'INVALID_TOKEN' : 'UNAUTHENTICATED',
    message: invalidToken ? 'Token verification failed' : 'Missing or invalid Bearer token',
    correlationId: boundedCorrelationId(correlationId),
  };
}

export function knativeRuntimeAuthorizationError(correlationId) {
  return {
    code: 'FORBIDDEN',
    message: 'Caller lacks a platform observer role',
    correlationId: boundedCorrelationId(correlationId),
  };
}

async function getKnativeRuntimeStatus(ctx) {
  return { statusCode: 200, body: publicKnativeStatus(ctx.knativeRuntime.status()) };
}

export const KNATIVE_RUNTIME_HANDLERS = { getKnativeRuntimeStatus };
