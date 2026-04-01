# Tasks: US-BKP-02-T05 — Pruebas de restauración funcional parcial y total en entornos sandbox

**Input**: Design documents from `/specs/119-sandbox-restore-functional-tests/`
**Prerequisites**: plan.md ✅ · spec.md ✅ · research.md ✅ · data-model.md ✅ · quickstart.md ✅ · contracts/ ✅
**Branch**: `119-sandbox-restore-functional-tests`
**Stack**: Node.js 20+ ESM · `node:test` · `node:assert` · `undici` · `kafkajs` · `pg`

**Organization**: Tasks follow the implementation sequence defined in `plan.md` — contract → helpers → fixtures → scenarios → runner → CI wiring.

## Format: `[ID] [P?] Description — exact file path`

- **[P]**: Can run in parallel (independent files, no blocking dependency on prior incomplete tasks)
- No `[Story]` labels — this entire task is a single story (US-BKP-02-T05); phases map to RF groups

---

## Phase 1: Setup — Contract & Schema

**Purpose**: Define the output contract of the test suite before implementing any logic; all other phases depend on this schema.

- [ ] T001 Materialize JSON Schema for restore test report artifact in `specs/119-sandbox-restore-functional-tests/contracts/restore-test-report.json` — schema must capture fields: `execution_id`, `correlation_id`, `started_at`, `ended_at`, `scenarios[]` (name, description, status: pass|fail|skip, duration_ms, failure_detail?), `summary` (total, passed, failed, skipped). Reference `data-model.md` for the full field spec.

**Checkpoint**: `contracts/restore-test-report.json` is valid JSON Schema (draft-07). Run `node -e "const s=JSON.parse(require('fs').readFileSync('specs/119-sandbox-restore-functional-tests/contracts/restore-test-report.json','utf8')); require('ajv').default && console.log('ok')"` to confirm parseable.

---

## Phase 2: Foundational — Shared Helpers

**Purpose**: HTTP client, correlation-id generator, retry utility and report writer are shared by every fixture and scenario. Must be complete before Phases 3+.

- [ ] T002 Create `tests/e2e/helpers/api-client.mjs` — ESM module exporting `createApiClient({ baseUrl, authToken })` returning a wrapper around `undici.fetch` that: sets `Authorization: Bearer` header, injects `X-Correlation-Id` from `correlation.mjs`, throws structured errors on non-2xx, and exposes typed helpers: `get(path)`, `post(path, body)`, `delete(path)`. Also export a lightweight Kafka consumer factory `createAuditConsumer({ brokers, topic, groupId })` backed by `kafkajs` for audit event verification.

- [ ] T003 [P] Create `tests/e2e/helpers/correlation.mjs` — ESM module exporting `generateExecutionId()` (returns `crypto.randomUUID()`) and `buildCorrelationId(executionId, scenarioName)` (returns `${RESTORE_TEST_CORRELATION_PREFIX}-${executionId}-${scenarioName}` where prefix is read from env var `RESTORE_TEST_CORRELATION_PREFIX`, default `restore-e2e`).

- [ ] T004 [P] Create `tests/e2e/helpers/retry.mjs` — ESM module exporting `withRetry(fn, { maxAttempts = 3, delayMs = 500 })` that retries async `fn` on rejection with exponential backoff, and `sleep(ms)` utility.

- [ ] T005 [P] Create `tests/e2e/helpers/report-writer.mjs` — ESM module exporting `writeReport(report, outputPath)` that: serializes `report` to JSON, writes to `outputPath`, validates the report against `contracts/restore-test-report.json` using `ajv` (throws if invalid), and also writes a human-readable text summary to `${outputPath}.txt`. Import the JSON schema using `JSON.parse(readFileSync(...))` — no dynamic import of non-ESM modules.

**Checkpoint**: Each helper is importable with `node --input-type=module` without runtime errors. No test runner needed at this stage.

---

## Phase 3: Lifecycle Fixtures — Tenant Factory & Cleanup

**Purpose**: Every scenario needs to create isolated tenants and guarantee cleanup. These two modules are prerequisites for all seed and scenario files.

- [ ] T006 Create `tests/e2e/fixtures/restore/tenant-factory.mjs` — ESM module exporting `createTestTenants(executionId, opts)` where `opts` may include `{ withSuspendedDst?: boolean, domains?: string[] }`. The function must: (1) POST to `GET /v1/admin/tenants/available-domains` to discover active domains for the sandbox (respecting `RESTORE_TEST_DOMAINS_ENABLED` env override), (2) POST to `/v1/admin/tenants` to create `test-restore-${executionId}-src` and `test-restore-${executionId}-dst` tenants (dst with state `suspended` if `withSuspendedDst=true`), (3) return `{ srcTenantId, dstTenantId, activeDomains, cleanup }` where `cleanup()` calls DELETE on both tenants with `withRetry` from `tests/e2e/helpers/retry.mjs`. Requires `ApiClient` instance injected via second argument. Env vars read: `RESTORE_TEST_API_BASE_URL`, `RESTORE_TEST_AUTH_TOKEN`, `RESTORE_TEST_CLEANUP_RETRIES` (default 3).

- [ ] T007 [P] Create `tests/e2e/fixtures/restore/cleanup.mjs` — ESM module exporting `cleanupByExecutionId(executionId, client)` that lists all tenants matching prefix `test-restore-${executionId}` and deletes them; intended for post-hoc cleanup when in-test cleanup failed. Also export `cleanupAllTestTenants(client)` that lists tenants with prefix `test-restore-` older than 24 h and deletes them (safe maintenance utility).

**Checkpoint**: Calling `createTestTenants` with a mock API client (via `undici.MockAgent`) creates two tenant names with correct pattern and calls DELETE on both when `cleanup()` is invoked.

---

## Phase 4: Seed Fixtures — Domain Data Population

**Purpose**: Populate tenant domains with realistic test data before export. All seed modules share the same signature and can be implemented in parallel.

- [ ] T008 [P] Create `tests/e2e/fixtures/restore/seed-iam.mjs` — ESM module exporting `seedIam(tenantId, executionId, level, client)` where `level` is `'minimal' | 'standard' | 'conflicting'`. Seed via Keycloak Admin REST API routed through APISIX: create realm roles (`restore-role-${executionId}-{n}`), groups, client scopes and optional IdP stub. `conflicting` level creates a role with the same name as the src tenant's role but different composite membership (to trigger E3 conflict). Returns manifest `{ roles: string[], groups: string[], clientScopes: string[] }`.

- [ ] T009 [P] Create `tests/e2e/fixtures/restore/seed-postgres.mjs` — ESM module exporting `seedPostgres(tenantId, executionId, level, client)`. Seed via `POST /v1/admin/tenants/{tenantId}/databases/schemas` API endpoint (not direct DB access): create schemas named `restore_${executionId}_{n}`, tables, views and indexes within those schemas. Returns manifest `{ schemas: string[], tables: string[], views: string[] }`.

- [ ] T010 [P] Create `tests/e2e/fixtures/restore/seed-kafka.mjs` — ESM module exporting `seedKafka(tenantId, executionId, level, client)`. Seed via `POST /v1/admin/tenants/{tenantId}/kafka/topics` API: create topics named `restore-${executionId}-topic-{n}` with valid `numPartitions` and ACLs. `level=standard` creates 3 topics; `level=minimal` creates 1. For EC1 the caller injects bad data post-artifact-build — this module always creates valid data. Returns manifest `{ topics: string[] }`.

- [ ] T011 [P] Create `tests/e2e/fixtures/restore/seed-storage.mjs` — ESM module exporting `seedStorage(tenantId, executionId, level, client)`. Seed via `POST /v1/admin/tenants/{tenantId}/storage/buckets` API: create S3-compatible buckets named `restore-${executionId}-bucket-{n}` with lifecycle and policy configurations. Returns manifest `{ buckets: string[] }`.

- [ ] T012 [P] Create `tests/e2e/fixtures/restore/seed-functions.mjs` — ESM module exporting `seedFunctions(tenantId, executionId, level, client)`. Guard at top: if env `RESTORE_TEST_OW_ENABLED !== 'true'`, immediately return `{ skipped: true, reason: 'OW_DISABLED' }`. Otherwise seed via OpenWhisk API: create packages and actions named `restore-${executionId}-pkg/action-{n}`. Returns manifest `{ packages: string[], actions: string[] }`.

- [ ] T013 [P] Create `tests/e2e/fixtures/restore/seed-mongo.mjs` — ESM module exporting `seedMongo(tenantId, executionId, level, client)`. Guard at top: if env `RESTORE_TEST_MONGO_ENABLED !== 'true'`, return `{ skipped: true, reason: 'MONGO_DISABLED' }`. Otherwise seed via tenant MongoDB metadata API: create collections and indexes named with `executionId`. Returns manifest.

**Checkpoint**: Each seed module is importable and returns early (skip) when optional services are disabled. No actual API calls needed for unit-level check.

---

## Phase 5: Core Test Utilities — Artifact Builder & Equivalence Asserter

**Purpose**: The two key utilities that drive every scenario — building the export artifact and comparing the restored tenant against it.

- [ ] T014 Create `tests/e2e/fixtures/restore/artifact-builder.mjs` — ESM module exporting `buildArtifact(tenantId, domains, client)` that: calls `POST /v1/admin/tenants/${tenantId}/config/export` with body `{ domains }` (omit `domains` key to export all), asserts HTTP 200 or 207, returns the parsed artifact JSON object. Also export `buildDegradedArtifact(tenantId, degradedDomain, client)` that builds a full artifact and then mutates `artifact.domains[degradedDomain].status = 'not_available'` and clears its data for E4. Also export `buildLargeArtifact(approxBytes, client)` that pads the artifact data fields to approach `CONFIG_EXPORT_MAX_ARTIFACT_BYTES` for EC4.

- [ ] T015 Create `tests/e2e/fixtures/restore/assert-equivalence.mjs` — ESM module exporting:
  - `assertEquivalence(dstTenantId, artifact, domainsToCheck, client)`: exports dst tenant via `POST /v1/admin/tenants/${dstTenantId}/config/export` and deep-compares each domain's structural data against the source artifact, excluding known internal-id fields (`realm_id`, `schema_prefix`, `namespace`, `tenant_prefix`). Uses `node:assert` `deepStrictEqual` with structured failure messages: `{ domain, resource, field, expected, actual }`.
  - `assertDomainEmpty(dstTenantId, domains, client)`: for each domain in `domains`, verifies the dst tenant has no resources of that type (calls the domain-specific list endpoint and asserts empty collection).
  - `assertConflictsPreserved(dstTenantId, conflictingResources, client)`: verifies that resources reported as conflicts by preflight remain unchanged in the dst tenant after reprovision.

**Checkpoint**: Both modules export named functions; `assertEquivalence` throws `AssertionError` when called with mismatched artifacts (verifiable via a small inline test with `node:test` `mock`).

---

## Phase 6: Main Scenarios — E1 through E5

**Purpose**: Implement the five primary restore scenarios from spec.md §3.1. E1 is the golden path and smoke-tests the entire chain; E2–E5 build on the same pattern.

- [ ] T016 Create `tests/e2e/workflows/restore/e1-full-restore-empty-tenant.test.mjs` — `node:test` module implementing E1 (Restauración total sobre tenant vacío). Steps: (1) `createTestTenants(executionId)`, (2) seed all active domains at `level=standard` on src, (3) `buildArtifact(src, all_active_domains)`, (4) call `POST /v1/admin/tenants/${dst}/config/reprovision/preflight` with artifact — assert `risk_level` in `['low','medium']` and zero critical conflicts, (5) call `POST /v1/admin/tenants/${dst}/config/reprovision` with artifact and `identifier_map` — assert HTTP 200 and all domains `status='applied'`, (6) `assertEquivalence(dst, artifact, all_active_domains)`, (7) verify Kafka audit event `console.config.reprovision.completed` with matching `correlation_id`, (8) `cleanup()`. Timeout: `RESTORE_TEST_SCENARIO_TIMEOUT_MS` (default 120000).

- [ ] T017 [P] Create `tests/e2e/workflows/restore/e2-partial-restore-domain-subset.test.mjs` — E2 (Restauración parcial). Runs two sub-tests via `node:test`: Combo A `['iam', 'postgres_metadata']` and Combo B `['kafka', 'storage']` (skip Combo B domains individually if not enabled). Steps per combo: seed src at `level=standard`, `buildArtifact(src)`, `POST reprovision` with `{ domains: combo }`, `assertEquivalence(dst, artifact, combo)`, `assertDomainEmpty(dst, all_active_domains.filter(d => !combo.includes(d)))`, `cleanup()`.

- [ ] T018 [P] Create `tests/e2e/workflows/restore/e3-restore-with-conflicts.test.mjs` — E3 (Restauración con conflictos). Steps: seed src at `level=standard`, seed dst IAM at `level=conflicting` (same role name, different composites), `buildArtifact(src)`, preflight dst — assert `domains.iam.conflicts.length > 0`, reprovision dst — assert HTTP 200, `assertConflictsPreserved(dst, preflight_conflicts)`, verify non-conflicting resources applied correctly, `cleanup()`.

- [ ] T019 [P] Create `tests/e2e/workflows/restore/e4-restore-degraded-artifact.test.mjs` — E4 (Artefacto con dominios degradados). Steps: seed src (iam + postgres + kafka + storage at `level=minimal`), `buildDegradedArtifact(src, 'mongo_metadata', client)` to get artifact with mongo_metadata status=`not_available`, reprovision dst — assert HTTP 200, verify `result.domains.mongo_metadata.status === 'skipped'`, verify other valid domains `status === 'applied'`, `assertEquivalence(dst, artifact, valid_domains)`, `cleanup()`.

- [ ] T020 [P] Create `tests/e2e/workflows/restore/e5-restore-format-migration.test.mjs` — E5 (Migración de formato). At top: call `GET /v1/admin/config/format-versions` to determine if a previous format version exists; if none, mark test as `skip` with message `'No prior format version available for migration test'`. Otherwise: construct artifact with prior `format_version`, call `POST /v1/admin/config/migrate` to upgrade, reprovision dst with migrated artifact, `assertEquivalence(dst, migrated_artifact, active_domains)`, `cleanup()`.

**Checkpoint**: E1 (`e1-full-restore-empty-tenant.test.mjs`) runs against a live sandbox and exits 0. E2–E5 are syntactically valid and importable.

---

## Phase 7: Edge Case Scenarios — EC1 through EC5

**Purpose**: Implement the five edge case scenarios from spec.md §3.2. Can be developed in parallel with Phase 6 once fixtures from Phases 3–5 are available.

- [ ] T021 [P] Create `tests/e2e/workflows/restore/ec1-partial-failure-retry.test.mjs` — EC1 (Fallo parcial y reintento). Strategy: inject invalid kafka data in artifact (set `numPartitions: -1` on one topic) after building valid artifact. Steps: seed src (iam + postgres + kafka), `buildArtifact(src)`, mutate artifact kafka topics to inject invalid partition count, reprovision dst with mutated artifact — assert HTTP 207 and `result.domains.kafka.status === 'error'`, assert `result.domains.iam.status === 'applied'` and `result.domains.postgres_metadata.status === 'applied'`, build corrected kafka-only artifact from original valid artifact, reprovision dst with `{ domains: ['kafka'] }` and corrected artifact — assert HTTP 200 and `status === 'applied'`, `assertEquivalence(dst, original_artifact, ['kafka'])`, `cleanup()`.

- [ ] T022 [P] Create `tests/e2e/workflows/restore/ec2-tenant-id-mismatch.test.mjs` — EC2 (Tenant origen inexistente). Steps: seed src, `buildArtifact(src)` — artifact contains `tenant_id` of src, call preflight on dst — assert `needs_confirmation === true` and `identifier_map_proposal` is present, reprovision dst with `confirmed_identifier_map` from proposal — assert HTTP 200, `assertEquivalence(dst, artifact_with_applied_map, active_domains)`, `cleanup()`.

- [ ] T023 [P] Create `tests/e2e/workflows/restore/ec3-concurrent-restore-blocked.test.mjs` — EC3 (Concurrencia bloqueada). Steps: seed src at `level=standard`, `buildArtifact(src)`, fire first reprovision request without awaiting (use AbortController with 60 s timeout), immediately fire second reprovision request on same dst — assert HTTP 409 with code `REPROVISION_IN_PROGRESS`, await first reprovision — assert HTTP 200, `cleanup()`. Note: if the first request returns before the second fires (very fast sandbox), retry with a slightly larger artifact (EC4 artifact); document this timing sensitivity.

- [ ] T024 [P] Create `tests/e2e/workflows/restore/ec4-max-size-artifact.test.mjs` — EC4 (Artefacto de tamaño máximo). Steps: `buildLargeArtifact(approxBytes = 9 * 1024 * 1024, client)` padded to ~9 MB (below the 10 MB limit), call preflight on dst — assert response in < 30 s with no size error, call reprovision — assert HTTP 200, verify at least one domain applied, `cleanup()`. Note: this test validates the system does NOT reject a near-maximum artifact; content equivalence not checked (synthetic artifact).

- [ ] T025 [P] Create `tests/e2e/workflows/restore/ec5-suspended-tenant-rejected.test.mjs` — EC5 (Tenant suspendido). Steps: `createTestTenants(executionId, { withSuspendedDst: true })`, seed src, `buildArtifact(src)`, reprovision suspended dst — assert HTTP 422 or 409 with error code indicating tenant is suspended (e.g., `TENANT_SUSPENDED` or `INVALID_TENANT_STATE`), verify dst remains unmodified (re-export dst and verify no domains changed), `cleanup()`.

**Checkpoint**: All EC files are syntactically valid and importable with `node --input-type=module`. EC1 logic is complete (failable domain injection is deterministic).

---

## Phase 8: Runner & Report Integration

**Purpose**: Wire all scenarios into a single runner that produces the structured report defined in Phase 1.

- [ ] T026 Create `tests/e2e/workflows/restore/index.test.mjs` — Main runner using `node:test`. Must: (1) read config from env vars (`RESTORE_TEST_API_BASE_URL`, `RESTORE_TEST_AUTH_TOKEN`, `RESTORE_TEST_PARALLELISM` default `false`, `RESTORE_TEST_DOMAINS_ENABLED`, `RESTORE_TEST_OW_ENABLED`, `RESTORE_TEST_MONGO_ENABLED`, `RESTORE_TEST_REPORT_OUTPUT` default `restore-test-report.json`, `RESTORE_TEST_SCENARIO_TIMEOUT_MS` default 120000, `RESTORE_TEST_CORRELATION_PREFIX` default `restore-e2e`), (2) import all 10 scenario modules, (3) run each scenario as a `node:test` `test()` call with the configured timeout — scenarios marked `skip` via `test.skip()` when preconditions not met, (4) collect results: name, status (`pass`|`fail`|`skip`), `duration_ms`, `failure_detail` (from caught AssertionError), (5) call `writeReport(report, outputPath)` from `tests/e2e/helpers/report-writer.mjs`, (6) emit a text summary to stderr: `Restore E2E: ${passed}/${total} passed, ${failed} failed, ${skipped} skipped`. Execution order: sequential by default; if `RESTORE_TEST_PARALLELISM=true` run E1–E5 and EC1–EC5 in Promise.all groups (scenarios within group run in parallel; cleanup still awaited per scenario).

- [ ] T027 [P] Create `tests/e2e/workflows/restore/README.md` — Quick reference for running the suite: required env vars, example invocation commands (single scenario vs full suite), expected output, troubleshooting tips (residual tenants, disabled domains). Cross-reference `specs/119-sandbox-restore-functional-tests/quickstart.md`.

**Checkpoint**: `node --test tests/e2e/workflows/restore/index.test.mjs` exits 0 in a sandbox environment with all env vars set. Report JSON is written and validates against `contracts/restore-test-report.json`.

---

## Phase 9: Polish & CI Wiring

**Purpose**: Root script, package.json wiring, and validation that the suite is CI-ready.

- [ ] T028 Add script `"test:e2e:restore": "node --test tests/e2e/workflows/restore/index.test.mjs"` to the root `package.json` under `"scripts"`. Preserve all existing scripts; make a minimal, surgical edit to the `scripts` block only.

- [ ] T029 [P] Validate `contracts/restore-test-report.json` is a well-formed JSON Schema draft-07 document by running `node -e "const Ajv=require('ajv');const ajv=new Ajv();ajv.compile(JSON.parse(require('fs').readFileSync('specs/119-sandbox-restore-functional-tests/contracts/restore-test-report.json','utf8')));console.log('schema valid')"` and confirming exit 0. Document the validation command in `quickstart.md` if not already present.

- [ ] T030 [P] Verify that `report-writer.mjs` validates its output against the schema at runtime: write a unit test in `tests/e2e/helpers/report-writer.test.mjs` using `node:test` that builds a minimal valid report object and a minimal invalid report object, calls `writeReport` on each, and asserts the invalid one throws. Run with `node --test tests/e2e/helpers/report-writer.test.mjs`.

- [ ] T031 [P] Verify cleanup robustness: write a unit test in `tests/e2e/fixtures/restore/cleanup.test.mjs` using `node:test` and `undici.MockAgent` that: (a) simulates `cleanupByExecutionId` when DELETE returns 404 (already gone) — asserts no error thrown, (b) simulates transient 503 followed by 200 — asserts `withRetry` retries and succeeds.

**Checkpoint**: `node --test tests/e2e/helpers/report-writer.test.mjs` and `node --test tests/e2e/fixtures/restore/cleanup.test.mjs` both pass. `package.json` `test:e2e:restore` script is present.

---

## Dependencies & Execution Order

### Phase Dependencies

```text
Phase 1 (Schema contract)         ← start immediately
Phase 2 (Helpers)                 ← start immediately; T003/T004/T005 parallel with T002
Phase 3 (Lifecycle fixtures)      ← depends on Phase 2 complete (needs api-client + retry)
Phase 4 (Seed fixtures)           ← depends on Phase 3 complete (needs tenant-factory); all seed modules parallel
Phase 5 (Core utilities)          ← depends on Phase 4 complete (needs seed manifests for equivalence logic)
Phase 6 (Main scenarios E1–E5)    ← depends on Phases 1–5 complete; E2–E5 parallel after E1 smoke-tests chain
Phase 7 (Edge cases EC1–EC5)      ← depends on Phases 1–5 complete; all EC files parallel
Phase 8 (Runner + report)         ← depends on Phases 6 + 7 complete
Phase 9 (Polish)                  ← depends on Phase 8 complete; T029/T030/T031 parallel with T028
```

### Task Dependencies (within phases)

- T002 (`api-client.mjs`) must complete before T006 (`tenant-factory.mjs`) — api-client is injected into factory
- T006 (`tenant-factory.mjs`) and T007 (`cleanup.mjs`) must complete before any seed (T008–T013)
- T014 (`artifact-builder.mjs`) and T015 (`assert-equivalence.mjs`) must complete before scenario files T016–T025
- T001 (`contracts/restore-test-report.json`) must complete before T005 (`report-writer.mjs`) — writer validates against it
- T016 (E1 golden path) should complete before T017–T020 to validate the full chain is reachable

### Parallel Opportunities

**Phase 2**: T002, T003, T004, T005 in parallel (different files, no dependencies between them)

**Phase 4**: T008, T009, T010, T011, T012, T013 all in parallel

**Phase 6 + 7 together** (after Phases 1–5):

```bash
# Parallel batch A — main scenarios E2–E5:
T017: e2-partial-restore-domain-subset.test.mjs
T018: e3-restore-with-conflicts.test.mjs
T019: e4-restore-degraded-artifact.test.mjs
T020: e5-restore-format-migration.test.mjs

# Parallel batch B — edge cases (simultaneous with batch A):
T021: ec1-partial-failure-retry.test.mjs
T022: ec2-tenant-id-mismatch.test.mjs
T023: ec3-concurrent-restore-blocked.test.mjs
T024: ec4-max-size-artifact.test.mjs
T025: ec5-suspended-tenant-rejected.test.mjs
```

**Phase 9**: T028, T029, T030, T031 in parallel

---

## Implementation Strategy

### MVP First (E1 smoke test validates the chain)

1. Complete Phase 1 (T001 — schema contract)
2. Complete Phase 2 (T002–T005 — helpers)
3. Complete Phase 3 (T006–T007 — lifecycle)
4. Complete Phase 4 (T008–T011 — seed for iam/postgres/kafka/storage; skip OW+Mongo initially)
5. Complete Phase 5 (T014–T015 — artifact-builder + assert-equivalence)
6. Complete T016 (E1 golden path) — **STOP and validate E1 passes against sandbox**
7. If E1 passes, proceed to Phase 6 remaining + Phase 7 in parallel
8. Complete Phase 8 (T026–T027 — runner + README)
9. Complete Phase 9 (T028–T031 — CI wiring + unit tests)

### Incremental Delivery

1. After T016 (E1) → first working smoke test of the full chain
2. After T017–T020 (E2–E5) → main scenario coverage complete (CA-01 to CA-05)
3. After T021–T025 (EC1–EC5) → full edge case coverage
4. After T026 (runner) → single-command invocation and structured report

### Key Environment Variables Required at Runtime

| Variable | Required | Default | Notes |
|---|---|---|---|
| `RESTORE_TEST_API_BASE_URL` | Yes | `http://localhost:9080` | APISIX sandbox URL |
| `RESTORE_TEST_AUTH_TOKEN` | Yes | — | JWT with `platform:admin:config:export` + `platform:admin:config:reprovision` |
| `RESTORE_TEST_PARALLELISM` | No | `false` | Set `true` for faster CI runs |
| `RESTORE_TEST_DOMAINS_ENABLED` | No | `iam,postgres_metadata,kafka,storage` | CSV of enabled domains |
| `RESTORE_TEST_OW_ENABLED` | No | `false` | Enable OW scenarios |
| `RESTORE_TEST_MONGO_ENABLED` | No | `false` | Enable MongoDB scenarios |
| `RESTORE_TEST_REPORT_OUTPUT` | No | `restore-test-report.json` | Output path for report |
| `RESTORE_TEST_CLEANUP_RETRIES` | No | `3` | Cleanup retry count |
| `RESTORE_TEST_SCENARIO_TIMEOUT_MS` | No | `120000` | Per-scenario timeout |
| `RESTORE_TEST_CORRELATION_PREFIX` | No | `restore-e2e` | Prefix for correlation IDs |

---

## Notes

- **No production API calls**: All scenarios use `RESTORE_TEST_API_BASE_URL` pointing to a sandbox; the auth token must only have access to sandbox tenants.
- **Secrets safety**: `RESTORE_TEST_AUTH_TOKEN` must never appear in report JSON or test logs. `report-writer.mjs` must not serialize env vars.
- **Residual tenant safety**: Tenant names follow `test-restore-{uuid}-{src|dst}` pattern; `cleanupAllTestTenants()` in `cleanup.mjs` can recover if automated cleanup fails.
- **OW and MongoDB optional**: T012 (`seed-functions.mjs`) and T013 (`seed-mongo.mjs`) guard on env vars and return `{ skipped: true }` when disabled. E1 (golden path) adjusts `all_active_domains` dynamically by querying the export domains endpoint — it does not hardcode 6 domains.
- **EC3 timing note**: If the sandbox processes reprovision requests so fast that the first completes before the second fires, EC3 may need to use a large/slow artifact. Document this in the test file with a `// TIMING NOTE` comment.
- **No DB bypass**: All verification in `assert-equivalence.mjs` goes through product APIs (re-export of dst tenant). Direct PostgreSQL/Kafka queries are only permitted in `seed-postgres.mjs` / `seed-kafka.mjs` if no API exists for seeding — not for assertions.
- **[P] tasks** = different files with no incomplete blocking dependencies; safe to assign to separate developers or agents in parallel.
