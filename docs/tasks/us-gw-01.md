# US-GW-01 — Unified, versioned, documented public API surface

## Delivered scope

This feature delivers the baseline public API surface for the gateway story under one coherent `/v1/*` contract family model.

### Implemented outcomes

- unified public OpenAPI contract at `apps/control-plane/openapi/control-plane.openapi.json`
- generated family contracts for:
  - `platform`
  - `tenants`
  - `workspaces`
  - `auth`
  - `postgres`
  - `mongo`
  - `events`
  - `functions`
  - `storage`
  - `metrics`
  - `websockets`
- generated route catalog at `services/internal-contracts/src/public-route-catalog.json`
- public API taxonomy baseline at `services/internal-contracts/src/public-api-taxonomy.json`
- gateway family routing manifest at `services/gateway-config/base/public-api-routing.yaml`
- published generated docs at `docs/reference/architecture/public-api-surface.md`
- control-plane and web-console catalog helpers for route discovery/filtering
- validation and tests covering contract generation, routing alignment, HTTP conventions, and taxonomy integrity

## Versioning baseline

- URI major version: `/v1`
- additive contract pin header: `X-API-Version: 2026-03-23`
- OpenAPI semantic version: `1.0.0`
- route discovery endpoint: `/v1/platform/route-catalog`

## Shared HTTP baseline

- every public route requires `X-API-Version`
- every public route requires `X-Correlation-Id`
- every mutating route requires `Idempotency-Key`
- route catalog filtering uses common query semantics (`family`, `scope`, `resourceType`, `method`, `audience`, `visibility`)
- collection-style discovery uses cursor pagination semantics (`page[size]`, `page[after]`, `sort`, `search`)

## Operational note

Regenerate derived public API artifacts with:

```bash
npm run generate:public-api
```

Validate the full public API chain with:

```bash
npm run validate:public-api
```
