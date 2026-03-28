# Tasks: Storage Event Notifications

**Input**: `specs/016-storage-event-notifications/spec.md`, `specs/016-storage-event-notifications/plan.md`  
**Task**: US-STO-02-T04  
**Branch**: `016-storage-event-notifications`

## Sequential execution plan

- [x] T001 Write `specs/016-storage-event-notifications/spec.md` with the bounded T04 feature specification.
- [x] T002 Write `specs/016-storage-event-notifications/plan.md` with the repo-bound implementation plan.
- [x] T003 Write `specs/016-storage-event-notifications/tasks.md` with the implementation checklist.

## Implementation checklist

- [x] T010 Create `services/adapters/src/storage-event-notifications.mjs` with frozen catalogs:
  - `STORAGE_EVENT_NOTIFICATION_CAPABILITY_ID`
  - `STORAGE_EVENT_NOTIFICATION_DESTINATION_TYPES`
  - `STORAGE_EVENT_NOTIFICATION_EVENT_TYPES`
  - `STORAGE_EVENT_NOTIFICATION_AUDIT_ACTIONS`
  - `STORAGE_EVENT_NOTIFICATION_ERROR_CODES`

- [x] T011 Continue `services/adapters/src/storage-event-notifications.mjs` with builders:
  - `buildStorageEventGovernanceProfile(input)`
  - `buildStorageEventNotificationRule(input)`
  - `buildStorageEventNotificationDeliveryPreview(input)`
  - `buildStorageEventNotificationAuditEvent(input)`

- [x] T012 Continue `services/adapters/src/storage-event-notifications.mjs` with validators/evaluators:
  - `checkStorageEventNotificationCapability(input)`
  - `validateStorageEventNotificationRule(input)`
  - `matchStorageEventNotificationRule(input)`
  - `evaluateStorageEventNotifications(input)`

- [x] T013 Extend `services/adapters/src/provider-catalog.mjs` additively with new constants and wrapper exports.

- [x] T014 Create `tests/unit/storage-event-notifications.test.mjs` covering catalogs, capability checks, governance, rule validation, matching, multi-rule evaluation, and audit redaction.

- [x] T015 Create `tests/adapters/storage-event-notifications.test.mjs` covering additive provider-catalog exports only.

- [x] T016 Extend `tests/contracts/storage-provider.contract.test.mjs` with an additive block covering governance/rule/evaluation shapes and the additive error catalog.

- [x] T017 Extend `tests/adapters/provider-catalog.test.mjs` with additive smoke coverage for the new event-notification exports.

- [x] T018 Create `tests/e2e/storage-event-notifications/README.md` with the static scenario matrix.

## Validation checklist

- [x] T030 Run `npm run lint:md`.
- [x] T031 Run `node --test tests/unit/storage-event-notifications.test.mjs`.
- [x] T032 Run `node --test tests/adapters/storage-event-notifications.test.mjs`.
- [x] T033 Run `node --test tests/adapters/provider-catalog.test.mjs`.
- [x] T034 Run `node --test tests/contracts/storage-provider.contract.test.mjs`.
- [x] T035 Run `npm test`.

## Delivery checklist

- [x] T040 Review git diff for T04 scope compliance.
- [ ] T041 Commit the feature branch changes for `US-STO-02-T04`.
- [ ] T042 Push `016-storage-event-notifications` to origin.
- [ ] T043 Open a PR to `main`.
- [ ] T044 Monitor CI, fix failures if needed, and merge when green.
