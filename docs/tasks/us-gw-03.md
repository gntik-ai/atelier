# US-GW-03 — Gateway QoS, request validation, uniform errors, idempotency, and hardening

## Scope delivered

This increment hardens the public gateway baseline introduced in `US-GW-01` and `US-GW-02`.

Delivered artifacts:

- family-level QoS profiles in `services/gateway-config/base/public-api-routing.yaml`
- gateway request-validation profiles with body-size budgets and spoofed-header rejection metadata
- uniform gateway error-envelope contract in the public OpenAPI document
- idempotency replay metadata for critical mutating routes and create/provision flows
- correlation-id continuity metadata and hardened internal request-attestation headers
- APISIX bootstrap rendering updates for rate limits, body size enforcement, timeouts, retries, and downstream header propagation
- route-catalog/doc generation updates exposing the new gateway-facing metadata
- resilience/reference tests covering timeouts, invalid headers, oversized bodies, and idempotent retries

## Main decisions

### QoS is applied per route family

Each `/v1/*` family now references explicit gateway QoS and request-validation profiles.

Profiles define:

- request rate budget
- request body-size ceiling
- timeout profile
- retry profile
- content-type expectations

### Uniform gateway failure surface

Public routes now advertise one shared `ErrorResponse` envelope with these required fields:

- `status`
- `code`
- `message`
- `detail`
- `requestId`
- `correlationId`
- `timestamp`
- `resource`

Relevant routes additionally advertise hardened gateway responses for:

- `413` oversized bodies
- `429` rate limiting
- `431` invalid or oversized headers
- `504` downstream timeout

### Idempotency and correlation continuity

- mutating public routes continue to require `Idempotency-Key`
- replay metadata is published through `X-Idempotency-Replayed`
- the default replay retention window is `86400` seconds
- `X-Correlation-Id` remains part of the public contract and the gateway now documents downstream continuity/backfill behavior

### Internal hardening mode

Downstream service calls from the gateway now carry an explicit validated-attestation header set:

- `X-Gateway-Managed-Route`
- `X-Correlation-Id`
- `X-Request-Id`
- `X-Internal-Request-Mode`
- `X-Internal-Request-Timestamp`

## Validation

Primary validation entry points:

```bash
npm run generate:public-api
npm run validate:public-api
npm run validate:gateway-policy
npm run validate:testing-strategy
npm run test:unit
npm run test:contracts
npm run test:resilience
```

## Residual implementation note

Cryptographic signing of gateway-to-internal calls is not yet introduced because the current repository baseline only exposes declarative APISIX/bootstrap configuration. This increment therefore hardens the trust boundary with validated attestation headers, correlation continuity, body-size enforcement, and explicit timeout/retry policy. A future runtime story can upgrade this contract to signed internal requests without changing the public API surface.
