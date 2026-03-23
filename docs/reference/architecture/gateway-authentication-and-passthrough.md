# Gateway authentication and native passthrough

## Intent

This document distinguishes the supported product API from the operational passthrough routes exposed by APISIX.

## Route classes

### 1. Product API

Supported tenant-facing and workspace-facing API families live under `/v1/*`.

Examples:

- `/v1/tenants/*`
- `/v1/workspaces/*`
- `/v1/functions/*`
- `/v1/storage/*`

Characteristics:

- protected through OIDC bearer-token enforcement in APISIX
- downstream auth context propagated through approved headers only
- family policies may require tenant/workspace bindings and plan capabilities
- this is the preferred and documented integration surface

### 2. Native passthrough

Operational passthrough routes live under `/_native/*`.

Current routes:

- `/_native/keycloak/admin/*`
- `/_native/openwhisk/api/v1/*`

Characteristics:

- intended for break-glass or specialist operational workflows
- never a substitute for the product API
- require elevated scopes plus superadmin-aligned access
- must emit audit logs at the gateway layer
- environment gated through `gatewayPolicy.passthrough.mode`

## Environment gating

| Environment | Passthrough mode | Effective behavior |
| --- | --- | --- |
| dev | `enabled` | Keycloak admin and OpenWhisk admin passthrough enabled |
| sandbox | `limited` | Keycloak admin passthrough enabled, OpenWhisk admin passthrough disabled |
| staging | `disabled` | No passthrough routes rendered |
| prod | `disabled` | No passthrough routes rendered |

## Propagated auth context

The gateway strips incoming spoofable auth-context headers and rehydrates trusted values from token claims before forwarding downstream.

Approved downstream headers:

- `X-Auth-Subject`
- `X-Actor-Username`
- `X-Tenant-Id`
- `X-Workspace-Id`
- `X-Plan-Id`
- `X-Auth-Scopes`
- `X-Actor-Roles`

Hardened gateway-to-internal attestation headers:

- `X-Gateway-Managed-Route`
- `X-Correlation-Id`
- `X-Request-Id`
- `X-Internal-Request-Mode`
- `X-Internal-Request-Timestamp`

Required request headers for protected product routes:

- `X-API-Version`
- `X-Correlation-Id`

Browser policy additionally allows:

- `Authorization`
- `Content-Type`
- `Idempotency-Key`
- `X-Requested-With`

Spoofable downstream context headers are no longer browser-allowed and the request-validation policy rejects them when they are supplied by clients.

## Troubleshooting

### Symptom: request works on `/_native/*` but not on `/v1/*`

Likely causes:

- the caller is using an operational passthrough path instead of the product API
- the product route family requires tenant/workspace context
- the assigned plan does not include the required family capability

Action:

1. check the route family in `services/gateway-config/base/public-api-routing.yaml`
2. inspect `planCapabilityAnyOf`, `tenantBinding`, and `workspaceBinding`
3. prefer the `/v1/*` endpoint unless you are explicitly performing an operator-only task

### Symptom: passthrough route is missing in staging or production

Expected. The deployment overlays set `gatewayPolicy.passthrough.mode=disabled` outside dev/sandbox.

### Symptom: downstream service sees user-supplied auth headers instead of trusted claims

Not expected. The policy requires `stripIncomingHeaders=true` and only approved claim-derived headers should be forwarded.

Validate with:

- `npm run validate:gateway-policy`
- `npm test -- tests/resilience/gateway-access-matrix.test.mjs`

### Symptom: tenant admin receives `deny` on functions routes

Expected for plans without `data.openwhisk.actions`.

Current matrix intentionally models:

- `basic_profile` on `growth` => functions allowed
- `tenant_admin` on `regulated` => functions denied
- `superadmin` on `enterprise` => functions allowed
