# US-ARC-03 Task Breakdown

## Story summary

Deliver the multi-tenant, multi-workspace contextual-authorization baseline so every sensitive operation can be evaluated with a shared security context, explicit ownership semantics, scope-aware permissions, downstream propagation rules, and negative-coverage expectations that prevent lateral access and privilege escalation.

## Backlog-to-artifact traceability

- **T01 — common security context with actor, tenant, workspace, plan, scopes, effective roles, correlation-id**
  - `services/internal-contracts/src/authorization-model.json`
  - `apps/control-plane/src/authorization-model.mjs`
  - `services/internal-contracts/src/internal-service-map.json`
- **T02 — reusable authorization policy for control APIs, data APIs, functions, events, storage**
  - `services/internal-contracts/src/authorization-model.json`
  - `services/adapters/src/authorization-policy.mjs`
  - `apps/control-plane/openapi/control-plane.openapi.json`
- **T03 — ownership, membership, delegation semantics by resource type**
  - `services/internal-contracts/src/authorization-model.json`
  - `docs/adr/0005-contextual-authorization-model.md`
  - `docs/reference/architecture/contextual-authorization.md`
- **T04 — initial permission matrix by platform, tenant, workspace role**
  - `services/internal-contracts/src/authorization-model.json`
  - `tests/unit/authorization-model.test.mjs`
  - `tests/contracts/authorization-model.contract.test.mjs`
- **T05 — propagate security context into adapters and audit logs**
  - `services/provisioning-orchestrator/src/authorization-context.mjs`
  - `services/audit/src/authorization-context.mjs`
  - `services/internal-contracts/src/internal-service-map.json`
- **T06 — cross-authorization and privilege-escalation negative tests**
  - `tests/reference/testing-strategy.yaml`
  - `tests/reference/reference-dataset.json`
  - `tests/e2e/console/contextual-authorization.test.mjs`
  - `tests/resilience/authorization-negative-scenarios.test.mjs`

## Executable plan

1. Add a machine-readable authorization-model contract aligned with the existing internal-contracts package.
2. Extend service-map and control-plane contracts so tenant/workspace authorization context propagates into internal commands, adapter calls, and audit evidence.
3. Add a minimal public access-check contract in OpenAPI to make contextual authorization externally visible and testable.
4. Record the decision and operating model in a new ADR and architecture companion note.
5. Add validators and automated tests for role catalog integrity, permission-matrix semantics, projection coverage, OpenAPI alignment, and privilege-escalation negatives.
6. Update repository scripts and structure validation so the new baseline stays enforced in CI.
