## Context

The public API is generated from `apps/control-plane-executor/openapi/control-plane.openapi.json`, while the deployable HTTP server assembles routes from a manually curated seed (`apps/control-plane/routes.mjs`) and an optional runtime overlay (`apps/control-plane/route-map.runtime.json`). The current validation gates verify the OpenAPI, generated artifacts, gateway family policy, and handler-module packaging independently, but no gate reconciles the C-08 public inventory with the production route table. Metadata/fixture tests can therefore pass while a real HTTP request falls through to `GW_NO_ROUTE`.

Fresh reproduction on base `6ce20a0a308bf25b385dedfe564601c239794c37` observed seven representative HTTP 404 responses and a complete static comparison of 25 published operations against the seed plus runtime overlay found 25 missing registrations.

## Goals

- Serve all 25 in-scope public operations through the same route assembly and HTTP boundary used by the image.
- Use real data sources and preserve the published authorization, isolation, validation, response, retry, idempotency, and audit contracts.
- Create a bounded parity gate that cannot be satisfied by fixture-only/test-only handlers or hard-coded success responses.
- Keep the correction isolated from other confirmed or blocked audit findings.

## Non-goals

- Redesigning the entire 416-operation public API or asserting that every unrelated public route is currently live.
- Repairing success schemas, error/header conventions, health/metrics, audit query/export, async operations, resource existence, privilege-domain audit, Flow execution events, or blocked role hypotheses.
- Expanding permissions, inventing aliases, adding console pages, or withdrawing `/v1` operations without the required independent versioning/deprecation decision.

## Decisions

### 1. Exact, checked-in C-08 inventory

The implementation will keep one machine-readable inventory of the 25 operation IDs and their canonical method/path pairs. Runtime-parity tests resolve the same operation IDs from the generated public catalog and compare normalized parameter templates against the production route assembly. The test fails for duplicates, missing operations, method/path drift, a missing handler export, a test-only module, or `GW_NO_ROUTE`.

This inventory is deliberately bounded to C-08. Expanding it to unrelated public operations would conflate distinct findings and prevent an isolated remediation.

### 2. Production handler, not registration-only stub

Each route reaches a handler that authenticates/authorizes, validates input, resolves its resource scope, and invokes a real repository/adapter/provider before returning a success. Empty collections are allowed only when the real scoped query returns no rows. Missing dependencies or disabled plan capabilities return the existing contract-owned failure status after dispatch; they must not become a fabricated empty/healthy response.

Pure contract-summary and fixture-builder helpers may be reused for normalization, but they cannot be the sole source for mutable or live operational state. Any required wrapper is production code, is packaged in the image, and is tested at the HTTP boundary.

### 3. Authorization and isolation remain operation-owned

The server-level auth setting provides only the published coarse gate. Handlers retain the operation-specific audience, plan-capability, tenant/workspace binding, and resource checks. Tenant/workspace IDs are resolved against verified identity context and durable resources. Caller-supplied identity headers are never trusted. Foreign and unknown resources preserve the established non-enumeration policy, and no route activation widens roles or scopes.

Unauthenticated/invalid-token requests stop before repository calls. Denied requests and invalid mutations have no domain effect. Authorization findings that lacked live principals remain blocked rather than being silently “fixed” here.

### 4. Read and mutation semantics

All 20 GET operations are side-effect-free with respect to product state. Existing bounded HTTP telemetry and access/denial audit hooks remain permitted.

The 5 POST operations validate the body and idempotency key before writes, run with a single transactional database client where required, produce at most one domain effect per idempotency key, and preserve the existing operation/audit linkage. Retries with the same semantic request return the same resource/operation outcome; conflicting reuse follows the published conflict contract.

### 5. Family-specific backing sources

- Audit correlation and Function-audit routes query the durable audit source with verified tenant/workspace predicates and contract masking; coverage aggregates only authorized platform-level evidence.
- Event dashboard, gateway-stream, and Kafka-topic routes use the deployed event/Kafka/metrics adapters. Missing telemetry is an explicit dependency/capability result, not a synthetic empty dashboard.
- Billing uses the durable `billing_usage_records` path with bounded pagination and platform/tenant predicates.
- Platform profiles, plans, quota policies, provider capabilities, and users use durable platform-governance repositories. Public POST operations use their idempotent write/audit path; public GET operations read the same source.
- Route catalog, topology regions, and storage-provider introspection read their canonical generated/runtime configuration source and return schema-valid projections.
- Tenant dashboard composes an authorized tenant record and its real governance sources; it does not reuse stale console context or hard-code health/quota widgets.

### 6. Contract, gateway, client, and documentation parity

The public method/path/operation IDs remain unchanged. Generated family OpenAPI, public catalog, and API reference are regenerated from the unified contract and checked for a clean second generation. Existing gateway family routing remains the external reachability boundary; explicit route assets are updated only where the deployed gateway actually requires them.

Existing SDK/console consumers are updated only when they already reference an in-scope operation. No new UI page is introduced. Read-only personas receive no mutation affordance, forbidden routes do not generate avoidable background calls, and scope changes clear stale data before issuing the new request.

Documentation names the personas, scopes, permissions, capabilities, empty/not-found/dependency outcomes, pagination/idempotency behavior, audit/correlation evidence, rollback, and the local-vs-live verification boundary.

### 7. Audit and metrics safety

Accepted mutations use the existing domain audit path with verified actor, resource, result, and correlation linkage. Denials use only the existing bounded denial hook. The remediation does not add a new audit event taxonomy.

HTTP metrics use registered route templates and bounded status/method labels. Raw tenant, workspace, user, resource, or correlation IDs never become metric labels. No new business metric family is added (C-07 remains out of scope).

### 8. Packaging and startup/build failure

The image copies every new production handler, repository, migration, and contract asset. A packaging test resolves all 25 route handlers using the image layout. Build/startup validation fails for missing modules/exports or route-contract drift rather than allowing a runtime 404/500.

## Alternatives considered

### Remove or deprecate the routes

Rejected for this bug fix. The `/v1` versioning policy requires an explicit breaking-change/deprecation decision, coexistence/sunset metadata, and coordinated contract/client/docs work. Silently depublishing promised operations to make a parity count pass would substitute a product decision for remediation.

### Register a common 501/empty-success handler

Rejected. It would change the error code while leaving the promised capability unimplemented, would bypass operation-specific authorization/data-source behavior, and would not meet the confirmed acceptance outcome.

### Validate all public operations globally

Deferred. A global source-of-truth redesign is valuable but would pull unrelated capability gaps/findings into C-08. The bounded inventory establishes the pattern without claiming broader runtime completeness.

## Migration and rollback

- Prefer existing stores and additive migrations. Any new platform-governance table/index/policy is applied through the existing startup migration mechanism, is backward compatible with the pre-change image, and contains no destructive backfill.
- Rolling back application code must not delete new durable rows or remove audit history. The old image may again return `GW_NO_ROUTE` for these endpoints, so rollback is an emergency availability action, not a functional restoration.
- Existing public paths and schemas are retained, so SDK/client migration is unnecessary. Added optional persistence is forward-compatible.
- No Kubernetes rollout is performed in this change. Live validation and any rollback rehearsal require separate authorization.

## Risks and mitigations

- **Authorization expansion:** route activation exposes previously unreachable code. Mitigation: operation-owned audience/capability checks, lower-role and P13 tests, and no role changes.
- **False success from metadata helpers:** mitigation: repository/adapter invocation assertions and dependency-failure tests.
- **Partial transaction/idempotency:** mitigation: dedicated DB client, replay/conflict tests, and audit/result reconciliation for all five POSTs.
- **Image-only failures:** mitigation: image-layout handler resolution and real HTTP assembly tests.
- **Scope creep into adjacent findings:** mitigation: exact 25-operation inventory and explicit out-of-scope assertions in tests/review.
