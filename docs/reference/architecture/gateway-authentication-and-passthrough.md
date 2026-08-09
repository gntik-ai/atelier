# Gateway authentication and native passthrough

> Status: **source-derived contract, not live-environment validation**. This page describes the
> gateway policy and executor trust boundaries represented in the repository. Whether a particular
> installation enables a native passthrough is deployment configuration and must be checked by an
> authorized operator.

## Product API and native routes are different surfaces

| Surface | Purpose | Discovery and stability |
|---|---|---|
| `/v1/*` | Falcone product APIs with normalized resources, tenant/workspace binding, capability gates, validation, idempotency, and `ErrorResponse` conventions. | Published in the route catalog, family OpenAPI documents, and [public API surface](./public-api-surface.md). |
| `/_native/*` | Narrow operator passthrough to an upstream administration API when explicitly enabled. | Governed by a separate allowlist and passthrough mode; intentionally excluded from the product route catalog and product compatibility contract. |

The current source allowlist contains one native route:

```text
/_native/keycloak/admin/* -> /auth/admin/*
```

It is an operator escape hatch for Keycloak administration, not a general reverse proxy. Adding a
path below `/_native` does not make it routable; the chart must declare the route, mode, plugins,
roles, scopes, rate limit, rewrite, audit action, and upstream explicitly.

## Authentication and trusted gateway context

Product and native routes use APISIX OIDC for bearer-token authentication. Selected product routes
also accept a Falcone API key, which the executor verifies and resolves to its stored tenant,
workspace, database role, and scopes. An API key's stored binding is authoritative over any caller
header.

The gateway removes caller-supplied identity context and rebuilds it from verified claims. The
downstream-only set includes:

```text
X-Auth-Subject
X-Actor-Username
X-Tenant-Id
X-Workspace-Id
X-Plan-Id
X-Auth-Scopes
X-Actor-Roles
```

Product routes also carry correlation/request identity and a `validated_attestation` internal
request mode. The executor accepts header-derived tenant/workspace identity only with the configured
gateway trust signal. When `GATEWAY_SHARED_SECRET` is configured, a missing or incorrect
`X-Gateway-Auth` value fails closed with `401`; clients cannot authenticate by setting
`X-Tenant-Id` or `X-Workspace-Id` themselves. A verified API key or JWT remains authoritative.

The executor retains an unguarded header-trust compatibility mode only when no gateway shared
secret is configured. That mode is for isolated development/tests; production deployments must
configure the shared trust secret and must not expose the executor directly.

## Authorization and passthrough boundary

Authentication establishes identity but does not authorize an operation.

For `/v1/*`, the gateway applies the cataloged family, audience, plan capability, request profile,
QoS, and route policy. The downstream handler then enforces the operation's platform, tenant,
workspace, resource, role, and scope rules. A broad gateway family match never replaces downstream
resource authorization.

For the current Keycloak passthrough, all of the following must be true:

- passthrough mode is `enabled` or `limited`; `disabled` removes the route;
- the verified principal is a `superadmin`;
- the token carries `gateway.native.keycloak.admin`;
- the Keycloak authorization plugin returns an enforcing decision; and
- the request passes native-admin body, rate-limit, CORS, and rewrite policy.

The native route has its own required audit logger. It omits request bodies and records the
correlation and verified principal/scope context. Granting a product capability does not grant
native passthrough, and native passthrough does not bypass tenant/workspace authorization on
Falcone's `/v1/*` resources.

## Failure and nondisclosure behavior

- Missing, invalid, or unverifiable credentials fail with `401` before a downstream identity is
  trusted.
- A valid identity without the route's role, scope, audience, plan, or resource permission is
  denied; a product route uses its cataloged `403` or tenant-safe `404` behavior.
- Client-supplied downstream identity headers are stripped/rejected, so an error cannot be used to
  promote the caller into another tenant or workspace.
- A missing or disabled native route is not a fallback to a broader upstream proxy.
- Product handlers preserve their bounded error and non-enumeration contracts. A native upstream
  response is not a Falcone product-resource representation and must not be used to infer another
  tenant's product state.

## Operator checks and support boundary

Before using a native route, confirm the effective passthrough mode and exact rendered APISIX route,
then verify that OIDC, Keycloak authorization, audit logging, rate limiting, context stripping, and
the downstream trust secret are all present. Do not copy a native URL into tenant applications or
SDKs; use the corresponding `/v1/*` product operation when one exists.

The authoritative source checks are the
[gateway policy contract](../../../tests/contracts/gateway-policy.contract.test.mjs),
[access-matrix test](../../../tests/resilience/gateway-access-matrix.test.mjs), and
[spoofed-header black-box test](../../../tests/blackbox/gateway-authn-strip-tenant-headers.test.mjs).
The longer [gateway routing reference](../../../docs-site/api/gateway.md) describes deployment
destinations and credential forms. These checks validate repository policy; this documentation did
not contact or certify a live gateway, Keycloak installation, or cluster.
