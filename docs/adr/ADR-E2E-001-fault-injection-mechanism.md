# ADR-E2E-001: Fault Injection Mechanism for Saga E2E Tests

**Status**: Accepted  
**Date**: 2026-03-30  
**Backlog**: US-UIB-01-T06

## Context

E2E tests for saga/compensation workflows (US-UIB-01-T06) must inject failures at
specific workflow steps to validate compensation paths, without modifying production code.

## Decision

Use in-process saga-definitions patching via the `sagaDefinitions` Map exported from
`apps/control-plane/src/saga/saga-definitions.mjs`. Each test temporarily replaces the
target step's `forward` function with one that throws on the configured call number.
The original function is captured before mutation and restored in `afterEach`.

For workflow-module-level tests (wf-con-XXX-*.mjs), use each module's existing
`__setWorkflowDependenciesForTest` hook.

## Rationale

- No production code is modified at test time.
- In-process patching avoids network-level fault injection infrastructure.
- The `sagaDefinitions` Map is module-scope; patching it affects only the current
  test process and is trivially restorable.
- Consistent with the existing `__setWorkflowAuditHooksForTesting` pattern.

## Alternatives Considered

1. **Environment-variable flags read by production code**: Rejected — requires production
   code changes; violates spec constraint.
2. **Network-level proxy fault injection (e.g., Toxiproxy)**: Rejected — requires
   external services; incompatible with offline CI.
3. **Separate stub action registrations in OpenWhisk**: Deferred — relevant only for
   HTTP-level E2E against a live OpenWhisk cluster.

## Consequences

- Tests are in-process only; they do not validate HTTP routing through APISIX.
- Compensation assertions rely on `workflow-audit.mjs` captures, not live DB queries.
- Live-environment E2E (APISIX → OpenWhisk → DB) is a future separate concern.
