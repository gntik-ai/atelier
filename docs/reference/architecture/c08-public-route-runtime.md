# C-08 public route runtime, migration, and rollback

## Outcome and scope

**Audience:** platform superadministrators, platform operators/SREs, security/audit readers,
plan/quota governors, and installers responsible for the control-plane image and PostgreSQL
schema.

**Status:** C-08 route-registration remediation; verified only with local/hermetic tests and a
local image build. It has not been deployed to Kubernetes or validated against a live cluster.

**Verification provenance:** candidate branch `fix/audit-c08-route-orphans`, based on
`origin/codex-integration` commit `6ce20a0a308bf25b385dedfe564601c239794c37`, verified on
2026-08-08.

C-08 closes the gap between the unified public OpenAPI/catalog and the deployable
control-plane. The 25 operations below are registered in both the seed route table and the
packaged runtime overlay. They enter authentication before any domain access and dispatch to
real local handlers; they no longer fall through to `404 GW_NO_ROUTE`.

This change does not deploy to Kubernetes or introduce a new metrics family. It adds the exact
`/v1/admin/functions/audit/coverage` APISIX route required because that platform-scoped operation
sits outside the ordinary `/v1/functions/*` family prefix; it remains bearer-only and targets the
control-plane, never the API-key executor route. The canonical public OpenAPI, generated clients,
public route catalog, and gateway policy remain the contract source of truth.

The gateway assets in this repository cover its base route configuration and the disposable
`deploy/kind` installation. The production Helm chart is maintained in a separate repository and
is not changed by this remediation. Before a production rollout, the chart owner must add the same
exact bearer-only path to the control-plane route, verify that it is absent from the API-key route,
and run that repository's chart validation. Until that companion change is reviewed, C-08 is not
ready for a production deployment even though the control-plane image is internally complete.

| Operation group | Operations | Runtime source |
|---|---:|---|
| Function audit and coverage | 4 GET | `plan_audit_events`, `quota_enforcement_log`, `fn_actions` |
| Audit correlation | 2 GET | tenant/workspace-scoped `plan_audit_events` |
| Workspace event/gateway/Kafka metrics | 3 GET | Prometheus, Kafka config, workspace topic registry |
| Billing usage | 2 GET | `billing_usage_records` |
| Deployment profiles | 1 POST, 1 GET | platform governance registry |
| Commercial plans | 1 POST, 1 GET | platform governance registry |
| Plan quota policies | 1 POST, 1 GET | platform governance registry |
| Provider capabilities | 1 POST, 1 GET | platform governance registry |
| Route/storage/topology discovery | 3 GET | generated route catalog, storage adapter, topology contract |
| Platform users | 1 POST, 1 GET | platform governance registry; no credentials |
| Tenant governance dashboard | 1 GET | repeatable-read composition of tenant resource registries and quota evidence |

The exact operation IDs are:

```text
getFunctionAuditCoverage
listFunctionDeploymentAudit
listFunctionQuotaEnforcement
listFunctionRollbackEvidence
getTenantAuditCorrelation
getWorkspaceAuditCorrelation
getWorkspaceEventDashboards
getWorkspaceGatewayStreamMetrics
getWorkspaceKafkaTopicMetrics
listBillingUsageRecords
listTenantBillingUsageRecords
createDeploymentProfileRecord
getDeploymentProfileRecord
createCommercialPlan
getCommercialPlan
createQuotaPolicy
getQuotaPolicy
createProviderCapabilityRecord
getProviderCapabilityRecord
getRouteCatalog
getStorageProviderIntrospection
listTopologyRegions
createPlatformUser
getPlatformUser
getTenantGovernanceDashboard
```

## Authorization and isolation

All 25 routes use the normal Bearer-JWT authentication boundary. Authorization is then
evaluated from the verified identity produced by `server.mjs`; client-supplied `x-tenant-id`,
`x-workspace-id`, `x-actor-*`, and body fields never establish identity or scope.

- Platform governance POSTs require `superadmin` or `platform_admin`. Platform operators and
  auditors cannot mutate governance entities.
- Platform GETs admit the appropriate platform team roles. Function coverage and correlation
  require platform audit permission; ordinary platform operator access is not treated as audit
  permission.
- Tenant correlation and dashboard reads require an advertised tenant role and the same tenant.
- Workspace correlation/function audit/metrics first resolve the durable workspace, mask a
  foreign workspace as not found, and require the advertised workspace/tenant membership.
- Every tenant/workspace SQL query retains its scope predicate. A constrained caller cannot
  widen a read by supplying another tenant or workspace in a header or body.
- Platform user records contain identity references and memberships, but no passwords, tokens,
  client secrets, private keys, or credentials. Obvious secret-bearing metadata key names are
  rejected before a transaction begins.

## Read filters, pagination, and empty outcomes

- The route catalog defaults to `page[size]=25` (maximum 200), returns an opaque
  `page.nextCursor`, and accepts that cursor as `page[after]`. Cursors are bound to the active
  filters and sort, so reusing one with a different query returns `400 INVALID_QUERY`. Exact
  filters are `family`, `scope`, `resourceType`, `method`, `audience`, and `visibility`; `search`
  covers human-facing route metadata, and `sort` supports `operationId`, `family`, `path`,
  `method`, or `summary` with an optional `-` prefix.
- Billing reads accept `page[size]` (default 25, maximum 200) and the opaque keyset cursor
  `page[after]`, matching the published OpenAPI. A cursor is bound to the platform-wide or
  tenant-specific billing scope; malformed or cross-scope reuse returns `400`. The
  tenant-specific path always binds `tenant_id` in SQL, and pages return camel-case
  `BillingUsageRecordList` projections. When another page exists, the response publishes its
  opaque continuation as `pagination.nextCursor`; pass that value unchanged as the next
  `page[after]`. The field is omitted on the final page. An empty real query returns `records: []`,
  not a fabricated row.
- Function-audit reads accept `limit` (default 50, maximum 200), `cursor`, `since`, `until`,
  `actionType`, `actor`, and `functionId`. Their cursor is ordered by durable
  `(created_at, id)`, and an existing workspace with no evidence returns an empty `AuditPage`.
- Function deploy, delete, and rollback attempts resolve their durable tenant/workspace and write
  a `function_audit_intents` row before the first external effect. Successful completion finalizes
  that intent into the audit hash chain and `function.audit.events` outbox before the HTTP response.
  If finalization fails after an effect, the durable intent remains pending and the retry worker
  converts it to error evidence after its recovery deadline; the attempt therefore cannot vanish.
  Failed/denied rollback attempts are included. The publisher claims pending rows with
  `FOR UPDATE SKIP LOCKED` and retains Kafka failures with bounded backoff.
- Function deploy evaluates the canonical `max_functions` limit and writes every allowed or
  denied decision to `quota_enforcement_log` before Knative. A denied decision returns `402`
  without an external deployment or `fn_actions` write.
- Audit correlation uses `includeRecords`, `includeEvidence`, and `maxItems` (maximum 200). A
  valid correlation absent from the scoped audit store returns `404 AUDIT_CORRELATION_NOT_FOUND`.
- Workspace metrics require `window=5m|1h|24h`. A real workspace with no Kafka topics returns an
  empty collection; a missing required backend or metric series returns the documented `503`.

## POST validation, idempotency, and audit

The five POST request bodies and their `202 MutationAccepted` responses are validated against
the schemas in `apps/control-plane-executor/openapi/control-plane.openapi.json` at runtime.
`additionalProperties: false`, nested membership schemas, identifier patterns, lifecycle states,
email format, quota limit shapes, and non-secret metadata are therefore enforced by the same
contract that drives clients.

Every POST requires:

```http
Authorization: Bearer <verified JWT>
Idempotency-Key: <8-128 characters from A-Z a-z 0-9 . _ : ->
Content-Type: application/json
```

Idempotency is scoped by `(operationId, verified actor subject, Idempotency-Key)` for 24 hours.
The request fingerprint is canonical and key-order independent.

- Same actor, operation, key, and semantic body: returns the original receipt and
  `X-Idempotency-Replayed: true`; no second entity, command, or audit event is created.
- Same actor, operation, and key with a different semantic body: returns
  `409 IDEMPOTENCY_KEY_CONFLICT`; no second effect is created.
- The same key used by another actor or another operation is isolated and cannot replay or reveal
  the first actor's result.
- Expiry removes only the renewable replay receipt. Entities, accepted commands, and audit
  evidence remain durable.

The entity projection, immutable accepted command, replay receipt, and one append-only platform
audit event are written in one PostgreSQL transaction. The platform audit chain is serialized
with an advisory transaction lock and SHA-256-linked through `prev_hash`/`row_hash`. It is
separate from `plan_audit_events` because platform-global mutations do not have a tenant owner.

Commercial plan creation permits its contractual `quotaPolicyId` as a forward allocation. The
nested quota-policy POST at `/v1/platform/plans/{planId}/quota-policies` materializes exactly that
promised `qta_` ID. This avoids an impossible creation cycle while retaining the parent-plan
boundary. Deployment profiles and plans verify existing referenced capabilities/profiles;
platform-user memberships verify real tenants/workspaces and the platform IAM realm.

## Metrics and dependency behavior

The metrics endpoints do not synthesize healthy values:

- Event dashboard widget `seriesCount` and coverage come from successful Prometheus query result
  sets. A successful query with no series is a real zero-series result.
- Gateway stream metrics require every series needed by the response contract. If Prometheus is
  unreachable, malformed, or missing a required series, the route returns `503` instead of zeros.
- Kafka topic metrics begin with the durable workspace topic inventory. Each topic's retention and
  compaction values come from Kafka `describeConfigs`; rates/lag/bridge/trigger counts come from
  Prometheus. A missing backend/config/series returns `503`. A real workspace with no registered
  topics returns an empty `topics` array.

No additional Prometheus business metric family or raw unbounded label was introduced. HTTP
telemetry continues to use the existing canonical route-template attribution.

The outbox publisher idempotently provisions `function.audit.events` with explicit partitions,
replication factor, and retention before connecting its producer with automatic topic creation
disabled. Existing topics are preserved. Bootstrap failure keeps the publisher disconnected and
is retried by its normal startup loop; it never discards a pending outbox row.

## Fresh install

The authoritative image boot path is:

1. `applyGovernanceSchema` applies migration 119 for billing reads and additive migration 123.
2. `seedC08CanonicalEntities` reads `packages/internal-contracts/src/domain-model.json` and
   upserts the 24 canonical deployment profile, plan, quota, and provider-capability projections.
3. Only rows marked `metadata.managedBy=falcone-canonical` are release-updated. Operator-created
   rows are preserved. No default platform user or credential is seeded.
4. The Function audit publisher ensures its canonical Kafka topic exists before sending a pending
   outbox event.
5. Schema readiness is marked ready only after migration and seed complete.
6. The Docker image copies every local handler, OpenAPI contract, storage/event adapter, migration,
   and generated contract consumed at runtime.

Local dry-run (default, no database connection):

```bash
node scripts/c08-platform-governance-migration.mjs
```

Expected output includes:

```json
{
  "mode": "dry-run",
  "databaseConnected": false,
  "migration": "packages/provisioning-orchestrator/src/migrations/123-c08-platform-governance-registry.sql",
  "clusterApplied": false
}
```

## Existing deployment upgrade

Do not run this against a live environment until the separately gated deployment workflow has
approved a backup and target database. The local/disposable command is:

```bash
DATABASE_URL='postgresql://…' node scripts/c08-platform-governance-migration.mjs --mode apply
```

The command applies only the forward part of migration 123 in a transaction, idempotently seeds
canonical release rows, and then verifies relations, canonical IDs, quota parents, command/audit
links, and the full platform audit hash chain. Re-running it is resumable and safe.

Expected successful output has `migrationApplied: true`, `seeded: 24`,
`verified.audit_chain_valid: true`, and `clusterApplied: false`. The connection string is never
printed.

Back up before an approved live upgrade. The destination must be an absolute path outside this
repository; creation is exclusive and mode `0600`:

```bash
DATABASE_URL='postgresql://…' node scripts/c08-platform-governance-migration.mjs \
  --mode backup \
  --output /secure/operator-backups/falcone-c08-$(date +%Y%m%dT%H%M%SZ).json
```

The backup contains governance projections, accepted commands, replay receipts, and audit rows.
It contains platform identity PII and must be handled as a restricted operational artifact. It
contains no credentials by design and must never be added to Git.

Independent verification:

```bash
DATABASE_URL='postgresql://…' node scripts/c08-platform-governance-migration.mjs --mode verify
```

Focused disposable verification before deployment:

```bash
node --test tests/blackbox/c08-route-registration.test.mjs
node --test tests/unit/c08-route-handlers.test.mjs
node --test tests/contracts/control-plane.openapi.test.mjs \
  tests/contracts/functions-audit.contract.test.mjs \
  tests/contracts/gateway-policy.contract.test.mjs
```

The black-box test sends all 25 concrete requests without credentials. Each must return
`401 GW_UNAUTHENTICATED`, proving the request matched a production route and reached auth; none may
return `GW_NO_ROUTE`.

## Data-retaining rollback

Normal rollback is application-only:

1. Stop writes through the five C-08 POSTs at the gateway/release boundary.
2. Run the non-mutating rollback check:

   ```bash
   DATABASE_URL='postgresql://…' node scripts/c08-platform-governance-migration.mjs --mode rollback-verify
   ```

3. Roll back the application image/chart through the separately approved release workflow.
4. Retain `platform_governance_entities`, `platform_governance_commands`,
   `platform_governance_idempotency`, `platform_governance_audit`, and
   `function_audit_outbox` plus `function_audit_intents`. Older code ignores them.
5. Re-run `--mode verify` before re-enabling a C-08-capable image.

Do not execute the migration file's documented `-- down` section during emergency rollback. It is
destructive and exists only to make the schema boundary explicit. A deliberate permanent removal
requires separate approval, a verified external backup, retention/privacy review, and a dedicated
change.

## Troubleshooting

- `GW_NO_ROUTE`: the seed and runtime route artifacts are stale. Inspect both
  `apps/control-plane/routes.mjs` and `apps/control-plane/route-map.runtime.json`, then rerun the
  black-box test. Do not add registration-only routes.
- `NO_HANDLER`: the Docker image omitted a local module or `b-handlers.mjs` export. Build-time local
  handler validation must pass before publishing the image.
- `C08_OUTPUT_CONTRACT_VIOLATION`: a repository/adapter produced a shape that no longer matches the
  unified OpenAPI. Treat it as contract drift; do not disable validation.
- `METRICS_DEPENDENCY_UNAVAILABLE`, `METRICS_SERIES_UNAVAILABLE`, or
  `KAFKA_CONFIG_DEPENDENCY_UNAVAILABLE`: restore the named dependency/series. These errors are
  intentional fail-honest behavior, not candidates for fixed zero fallbacks.
- `IDEMPOTENCY_KEY_CONFLICT`: the actor reused a live key for a different body. Retry with the
  original body to replay, or use a new key for a new mutation.
- `REFERENCED_ENTITY_NOT_FOUND`: create/select a real referenced profile/capability/tenant/workspace.
  For plan/quota creation, create the plan with its promised `quotaPolicyId`, then create the nested
  quota at that plan path.
- Boot fails while seeding canonical rows: verify migration 123 ran, the canonical catalog has not
  collided with an operator row using the same slug, and the image contains `domain-model.json`.

All commands above are local database/build/test operations. None contacts Kubernetes.
