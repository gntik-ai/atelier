# Implementation Plan: US-STO-02-T04 — Storage Event Notifications

**Feature Branch**: `016-storage-event-notifications`
**Spec**: `specs/016-storage-event-notifications/spec.md`
**Task**: US-STO-02-T04
**Epic**: EP-12 — Storage S3-compatible
**Status**: Ready for implementation
**Created**: 2026-03-28

---

## 1. Scope Summary

This task adds a pure-functional storage event-notification layer to the adapter surface. The delivery stays repo-local, additive, and preview-oriented: it validates notification-rule declarations, checks provider capability availability, enforces destination governance and rule quotas, matches storage events against active rules, and emits immutable delivery-preview and audit artifacts.

No live Kafka publish, OpenWhisk invocation, provider-side bucket notification configuration, or UI work is included.

---

## 2. Dependency Map

| Prior task | Spec | Module | What this task consumes |
|---|---|---|---|
| T01 — Provider abstraction | `007` | `storage-provider-profile.mjs` | provider profile and optional capability-detail input |
| T03 — Bucket/object ops | `009` | `storage-bucket-object-ops.mjs` | storage mutation semantics and bucket/object identifiers |
| T05 — Error taxonomy | `011` | `storage-error-taxonomy.mjs` | normalized storage codes for additive error catalog |
| T01 — Multipart/presigned | `013` | `storage-multipart-presigned.mjs` | multipart completion event family alignment |
| T02 — Bucket policies | `014` | `storage-access-policy.mjs` | permission/governance framing and additive catalog patterns |
| T03 — Capacity quotas | `015` | `storage-capacity-quotas.mjs` | additive quota-governance design pattern |
| US-EVT-03 | external story dependency | event backbone | Kafka/OpenWhisk target semantics and event-driven intent |

---

## 3. New Artifact

### 3.1 Core module

**`services/adapters/src/storage-event-notifications.mjs`**

Pure-functional module, no live I/O.

Exports:

```text
// catalogs
STORAGE_EVENT_NOTIFICATION_CAPABILITY_ID
STORAGE_EVENT_NOTIFICATION_DESTINATION_TYPES
STORAGE_EVENT_NOTIFICATION_EVENT_TYPES
STORAGE_EVENT_NOTIFICATION_AUDIT_ACTIONS
STORAGE_EVENT_NOTIFICATION_ERROR_CODES

// builders
buildStorageEventGovernanceProfile(input)
buildStorageEventNotificationRule(input)
buildStorageEventNotificationDeliveryPreview(input)
buildStorageEventNotificationAuditEvent(input)

// validators / evaluators
checkStorageEventNotificationCapability(input)
validateStorageEventNotificationRule(input)
matchStorageEventNotificationRule(input)
evaluateStorageEventNotifications(input)
```

### 3.2 Data-shape intent

- **Governance profile**: tenant/workspace limits + destination entitlements.
- **Rule**: immutable bucket-scoped declaration with event set, destination, filters, enabled state, actor, and timestamps.
- **Delivery preview**: immutable summary of one matched storage event routed to one destination.
- **Audit event**: immutable safe summary of rule lifecycle or delivery evaluation outcome.

---

## 4. Technical Design

### 4.1 Capability gate

Introduce a local explicit capability constant, e.g. `bucket.event_notifications`. The evaluator must:
- inspect `providerProfile.capabilityDetails` for that capability when provided,
- accept only `satisfied`,
- treat missing or non-satisfied entries as unsupported,
- return a bounded additive error envelope with fallback guidance.

This consumes capability input without broadening tenant-facing provider-capability publication, which remains the responsibility of `US-STO-02-T05`.

### 4.2 Governance model

Create a normalized governance profile with:
- `tenantId`, `workspaceId`
- allowed destination types (`kafka_topic`, `openwhisk_action`)
- max rules at tenant scope and workspace scope
- current rule counts at tenant scope and workspace scope

Validation rules:
- selected destination type must be allowed,
- next rule count must not exceed either effective scope limit,
- governance input omissions default to safe bounded behavior, not implicit wide-open support.

### 4.3 Rule model

A rule is bucket-scoped and contains:
- `ruleId`
- `tenantId`, `workspaceId`, `bucketId`
- `destinationType`, `destinationRef`
- `eventTypes[]`
- `filters.prefix`, `filters.suffix`
- `enabled`
- `createdAt`, `updatedAt`, `actorRef`, `correlationId`

Normalize inputs, freeze results, and reject empty event sets or invalid destination references.

### 4.4 Event matching and delivery previews

Create a matcher that checks:
- same tenant/workspace/bucket scope,
- rule enabled,
- event type membership,
- prefix/suffix filters,
- capability still available.

`evaluateStorageEventNotifications` must iterate active rules in stable order and return:
- `matches[]` delivery previews
- `nonMatches[]` optional rule-level reasons
- `supported` / `allowed` summary
- `evaluatedAt`

Each delivery preview must include destination, matched rule, event type, object identity, actor/correlation metadata, and audit-safe context only.

### 4.5 Audit model

Audit builder must support actions such as:
- `rule_created`
- `rule_updated`
- `rule_deleted`
- `delivery_previewed`
- `delivery_blocked`

Audit payloads must redact URL-like and secret-like strings and must not serialize presigned URLs or credentials.

---

## 5. Files to Change

### New

- `services/adapters/src/storage-event-notifications.mjs`
- `tests/unit/storage-event-notifications.test.mjs`
- `tests/adapters/storage-event-notifications.test.mjs`
- `tests/e2e/storage-event-notifications/README.md`
- `specs/016-storage-event-notifications/spec.md`
- `specs/016-storage-event-notifications/plan.md`
- `specs/016-storage-event-notifications/tasks.md`

### Additive modifications

- `services/adapters/src/provider-catalog.mjs`
- `tests/contracts/storage-provider.contract.test.mjs`
- `tests/adapters/provider-catalog.test.mjs`

---

## 6. Test Strategy

### Unit

Validate:
- frozen catalogs and error definitions,
- capability check behavior for satisfied / unsatisfied / missing capability,
- governance profile construction and quota checks,
- rule validation success/failure,
- prefix/suffix matching,
- multi-rule evaluation,
- audit redaction.

### Adapter

Validate all new exports exclusively through `provider-catalog.mjs`.

### Contract

Add one additive block asserting rule/governance/evaluation structures and additive error catalog availability.

### E2E (static matrix)

Document scenarios for:
- Kafka create-event routing,
- OpenWhisk multipart-complete routing,
- unsupported-capability degradation,
- quota exhaustion,
- destination-entitlement denial,
- multi-rule fan-out and audit evidence.

---

## 7. Risks, Compatibility, and Rollback

- Risk: capability-id drift before `US-STO-02-T05`. Mitigation: keep capability consumption local and additive.
- Risk: over-coupling to live Kafka/OpenWhisk schemas. Mitigation: preview-only delivery records in this task.
- Compatibility: additive provider-catalog exports only; do not modify existing behaviors.
- Rollback: safe git revert of the new module, tests, docs, and additive catalog exports.

---

## 8. Done Criteria

Done means:
- the new event-notification module exists and is fully covered by unit tests,
- provider-catalog additive exports are available and tested,
- contract tests pass with the additive block,
- markdown lint and full test suite pass,
- branch is ready for commit/push/PR/CI/merge.
