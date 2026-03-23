# ADR 0008: Unified public API route families and generated discovery artifacts

- Status: Accepted
- Date: 2026-03-23

## Context

The platform backlog requires one coherent public API surface exposed through APISIX, versioned under stable `/v1/*` families, documented with OpenAPI, discoverable from API and console flows, and aligned with multi-tenant authorization, auditability, quotas, and downstream service taxonomy.

Earlier repository baselines already defined:

- a control-plane OpenAPI contract
- contextual authorization contracts
- canonical domain entities and governance catalogs
- gateway/deployment topology baselines

What was still missing was one explicit public API taxonomy tying those pieces together into a documented and machine-checkable gateway surface.

## Decision

We standardize the public API around one unified contract and generate all derivative artifacts from it.

### Route families

The public surface is organized under these stable `/v1/*` families:

- `/v1/platform`
- `/v1/tenants`
- `/v1/workspaces`
- `/v1/auth`
- `/v1/postgres`
- `/v1/mongo`
- `/v1/events`
- `/v1/functions`
- `/v1/storage`
- `/v1/metrics`
- `/v1/websockets`

### Versioning

- URI major version stays at `/v1`
- additive contract pinning happens through `X-API-Version`
- the current published header value is `2026-03-23`
- the unified OpenAPI document carries semantic version `1.0.0`
- breaking changes require a new URI family such as `/v2`

### Source of truth and generated artifacts

The repository keeps one source-of-truth OpenAPI document at:

- `apps/control-plane/openapi/control-plane.openapi.json`

Generated artifacts include:

- family-specific OpenAPI documents in `apps/control-plane/openapi/families/`
- a machine-readable route catalog in `services/internal-contracts/src/public-route-catalog.json`
- published reference documentation in `docs/reference/architecture/public-api-surface.md`

### Shared HTTP conventions

Every public route must preserve these gateway-level conventions:

- `X-API-Version` required
- `X-Correlation-Id` required
- `Idempotency-Key` required for mutating operations
- shared error envelope usage
- shared route-catalog filtering and cursor-pagination semantics for discovery/list style endpoints

### Gateway/service alignment

The public family taxonomy is captured in:

- `services/internal-contracts/src/public-api-taxonomy.json`
- `services/gateway-config/base/public-api-routing.yaml`

This keeps family prefixes, owning services, scopes, downstream contracts, and route classes auditable and testable.

## Consequences

### Positive

- all published public routes are discoverable and grouped coherently
- family contracts can be regenerated automatically from the unified document
- gateway routing and documentation drift become machine-detectable
- console and control-plane code can share one route-catalog source
- future `/v2` planning has a clear migration boundary

### Trade-offs

- the unified contract now carries richer gateway metadata (`x-family`, scope, audience, route-class semantics)
- artifact generation must stay in the validation path to prevent stale family docs or stale catalog output
- some control-plane create flows now carry parent scope context in the request body instead of only in nested paths to preserve family coherence

## Alternatives considered

### Keep a single monolithic OpenAPI file only

Rejected because it does not provide explicit family-level contracts, discovery metadata, or gateway taxonomy alignment.

### Hand-maintain separate family contracts

Rejected because drift between the aggregate contract, family contracts, catalog, and docs would be likely and hard to audit.

## Follow-up expectations

Future feature work should extend the unified contract first, then regenerate family docs, route catalog, and published documentation through the existing automation.
