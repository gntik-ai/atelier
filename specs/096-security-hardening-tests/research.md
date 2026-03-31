# Research: Security Hardening Tests (US-SEC-02-T06)

**Branch**: `096-security-hardening-tests`  
**Date**: 2026-03-31  
**Phase**: 0 — Decisions resolved before Phase 1 design

---

## Decision 1: Test runner — `node:test` (built-in) vs Jest vs Vitest

**Decision**: `node:test` (Node.js 20 built-in)

**Rationale**:
- All existing backend tests in this monorepo use `node:test` (see `tests/integration/`, `tests/scope-enforcement/`). Consistency reduces cognitive load and toolchain dependencies.
- No additional dependency to install; aligns with the project's pnpm workspaces convention of minimal deps.
- `node:test` supports `describe`/`it`/`assert` with subtests, TAP output and timeout configuration — sufficient for hardening scenarios.
- Avoids the boot-time overhead of Jest's transform pipeline (important for the < 10 min target, SC-003).

**Alternatives considered**:
- Jest: familiar API but adds ~50 MB dep, requires ESM transform config, inconsistent with existing test tooling.
- Vitest: used in web-console tests (React/Tailwind) but not for backend suites; mixing would create confusion about which runner to use.

---

## Decision 2: Audit event verification — PostgreSQL polling vs Kafka consumer

**Decision**: PostgreSQL polling as primary, Kafka consumer as secondary (for secrets domain)

**Rationale**:
- T03 (`scope-enforcement`) and T04 (`privilege-domain`) already persist denials in `scope_enforcement_denials` and `privilege_domain_denials` tables respectively (see `services/provisioning-orchestrator/src/migrations/093-scope-enforcement.sql`, `094-admin-data-privilege-separation.sql`).
- Direct `SELECT` with a 200 ms poll interval reaches the 5-second SLA (SC-002) reliably, without the overhead of group coordinator handshake in a Kafka consumer.
- Kafka consumer adds connection complexity (group management, partition assignment) for short-lived test processes. Suitable as fallback for secrets domain where there is no denial table (only Kafka topics `console.secrets.rotation.*`).
- Dual-source strategy: if PostgreSQL is unavailable (unlikely in CI), fall back to Kafka. This is controlled by `HARDENING_AUDIT_SOURCE` env var.

**Alternatives considered**:
- Kafka-only: consistent interface but slower setup, requires committed offsets management per run to avoid replaying old events from prior runs.
- REST audit-query endpoints (T03/T04 OpenWhisk actions): adds HTTP hop latency and auth complexity; not suitable inside the test loop.

---

## Decision 3: Fixture isolation strategy — UUID per run vs per-suite

**Decision**: UUID per run (`run.mjs` generates one UUID, all suites in that run share it)

**Rationale**:
- Simplifies teardown: one `teardownFixture(runId)` call at the end cleans up all resources created in that run.
- Concurrent pipelines each get their own `runId`; resources tagged with `hardening-run-{runId}` are naturally isolated.
- Cross-suite resource sharing within the same run is intentional: tenant-isolation tests need Tenant A and Tenant B fixtures, both provisioned once and reused across TI-01/TI-02/TI-03.
- Per-suite isolation would double the provisioning time and increase the risk of hitting tenant-creation rate limits.

**Alternatives considered**:
- Per-test UUID: maximum isolation but 25× more fixtures → provisioning dominates total suite time.
- Shared global fixtures (not per-run): cross-contamination risk in concurrent pipeline runs; rejected.

---

## Decision 4: HTTP client — `undici` vs native `fetch`

**Decision**: `undici` directly

**Rationale**:
- Node.js 20 ships with `undici` as the engine for the global `fetch`. Using `undici` directly gives access to `ProxyAgent`, `MockAgent` (for unit tests of the http-client wrapper), and explicit connection pools.
- Custom request logging (method, path, status, latency) is easier with `undici`'s `Dispatcher` API than with the `fetch` wrapper.
- Already present in the Node.js runtime; no additional pnpm dep needed (`undici` is a peer of Node 20).

**Alternatives considered**:
- Global `fetch`: cleaner API but less flexible for test scenarios that need precise connection control or mock injection.
- `axios`: extra dep, CommonJS-first design, no advantage over `undici` for this use case.

---

## Decision 5: Plan cache bypass for plan-restriction tests

**Decision**: Use `PLAN_CACHE_BYPASS_HEADER` environment variable to configure a special request header that instructs APISIX to skip plan cache lookup for test requests

**Rationale**:
- The plan cache TTL (`SCOPE_ENFORCEMENT_PLAN_CACHE_TTL_SECONDS`, default 30s) makes plan-downgrade tests non-deterministic if the cache is not bypassed.
- A configurable bypass header (e.g., `X-Hardening-Bypass-Cache: true`) validated by the scope-enforcement Lua plugin against a shared secret allows tests to force a fresh cache evaluation without modifying production cache logic.
- This header is only honoured when `HARDENING_CACHE_BYPASS_SECRET` matches the configured value in the plugin; it is a no-op in production (where the env var is unset).
- Alternative: wait for TTL expiry (30 s per test × 4 plan tests = ~2 min overhead) — rejected as it jeopardises SC-003.

**Alternatives considered**:
- Direct DB mutation to invalidate plan cache: tightly couples test to internal implementation.
- Separate test-only APISIX instance with cache TTL=0: complex infra, not portable to all environments.

---

## Decision 6: Hardening suite location — `tests/hardening/` vs `tests/e2e/security/`

**Decision**: `tests/hardening/` as a top-level directory under `tests/`

**Rationale**:
- E2E tests (`tests/e2e/`) are organised by user-visible feature area (console, functions, storage, etc.). Hardening tests are cross-cutting security validations — they span multiple feature areas and are run on a different cadence (pre-release gates, continuous security validation).
- Separate directory makes it easy to run hardening-only in CI (`node tests/hardening/run.mjs`) without running the full E2E suite.
- Constitution Principle I (Monorepo Separation of Concerns) is maintained: `tests/hardening/` is a sibling of `tests/e2e/`, not a new top-level folder.

**Alternatives considered**:
- `tests/e2e/security/`: mixes concerns (user-facing E2E vs security gate); harder to gate separately in CI.
- `services/security-audit/`: would imply a deployable service, which this is not.
