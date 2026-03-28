# Tasks: US-STO-03-T01 — Scoped Programmatic Storage Credentials

**Input**: `specs/019-storage-scoped-access-credentials/spec.md`
**Feature Branch**: `019-storage-scoped-access-credentials`
**Task**: US-STO-03-T01

---

## Phase 1 — Domain contracts and vocabulary

- [ ] T001 Add `STORAGE_CREDENTIAL_STATES` frozen record to `services/adapters/src/storage-tenant-context.mjs` with states: `active`, `rotating`, `revoked`, `expired`. Export it.
- [ ] T002 Add `STORAGE_CREDENTIAL_ERROR_CODES` frozen record to `services/adapters/src/storage-error-taxonomy.mjs` covering: `CREDENTIAL_SCOPE_EXCEEDS_PRINCIPAL_PERMISSIONS`, `CREDENTIAL_BUCKET_RESTRICTION_VIOLATED`, `CREDENTIAL_LIMIT_EXCEEDED`, `CREDENTIAL_ROTATION_IN_PROGRESS`, `CREDENTIAL_REVOKED`, `CREDENTIAL_EXPIRED`, `CREDENTIAL_NOT_FOUND`, `CREDENTIAL_CROSS_WORKSPACE_DENIED`. Export it.
- [ ] T003 Add `STORAGE_CREDENTIAL_LIFECYCLE_EVENT_TYPES` frozen record (to `storage-tenant-context.mjs` or a new `storage-scoped-credentials.mjs` adapter module): `CREATED`, `ROTATION_INITIATED`, `ROTATION_CONFIRMED`, `ROTATION_GRACE_EXPIRED`, `REVOKED_EXPLICIT`, `REVOKED_CASCADE_PRINCIPAL`, `REVOKED_CASCADE_WORKSPACE`, `REVOKED_CASCADE_TENANT`, `EXPIRED`. Export it.
- [ ] T004 Define and export `STORAGE_CREDENTIAL_GOVERNANCE_DEFAULTS` frozen record (max active credentials per principal, max active credentials per workspace, max rotation grace period seconds) as platform-wide system defaults; co-locate with the credential module.

---

## Phase 2 — Adapter: credential record builder

- [ ] T005 Create `services/adapters/src/storage-scoped-credentials.mjs`. Implement and export `buildScopedStorageCredential(input)` that constructs a canonical programmatic credential record with fields: `entityType` (`programmatic_storage_credential`), `credentialId` (deterministic from tenantId + workspaceId + principalId + nonce), `accessKeyId` (derived from credentialId, provider-compatible format), `ownerPrincipal` (`{ type, id }`), `workspaceId`, `tenantId`, `permissionScope` (validated array of `STORAGE_POLICY_ACTIONS`), `bucketRestrictions` (array of bucket IDs or `null` for unrestricted), `lifecycleState` (default `active`), `createdAt`, `expiresAt` (nullable ISO string), `rotationState` (null or `{ newKeyPairId, graceExpiresAt }`), `version`.
- [ ] T006 Implement and export `validateCredentialScope({ requestedScope, principalEffectiveActions })` in `storage-scoped-credentials.mjs` that returns `{ valid: boolean, violations: string[] }`. Rejects any action in `requestedScope` not present in `principalEffectiveActions`. References `STORAGE_POLICY_ACTIONS` vocabulary.
- [ ] T007 Implement and export `intersectCredentialScope({ credentialScope, principalCurrentActions })` in `storage-scoped-credentials.mjs` that returns the runtime-effective action set as the intersection of the credential's defined scope and the principal's current permissions (FR-011).
- [ ] T008 Implement and export `buildCredentialLifecycleEvent(input)` in `storage-scoped-credentials.mjs` that produces an immutable audit event with: `eventType` (from `STORAGE_CREDENTIAL_LIFECYCLE_EVENT_TYPES`), `credentialId`, `actorPrincipal` (`{ type, id }`), `workspaceId`, `tenantId`, `timestamp`, and no secret key material. Assert secret absence in the builder.
- [ ] T009 Implement and export `initiateCredentialRotation({ credential, gracePeriodSeconds, now })` in `storage-scoped-credentials.mjs` that returns a credential record in `rotating` state with `rotationState` populated (`newKeyPairId`, `graceExpiresAt`). Rejects if a rotation is already in progress.
- [ ] T010 Implement and export `confirmCredentialRotation({ credential, now })` that finalizes the rotation: returns the credential in `active` state with the new access key as the canonical key, old key invalidated, `rotationState` cleared. Rejects if credential is not in `rotating` state.
- [ ] T011 Implement and export `revokeCredential({ credential, revokedBy, reason, now })` that returns the credential in `revoked` state. Works regardless of current `lifecycleState` (including `rotating` — concurrent rotation-and-revocation revokes both key pairs per edge-case rule in spec).
- [ ] T012 Implement and export `expireCredential({ credential, now })` that transitions a credential past its `expiresAt` to `expired` state. Returns the updated record. Rejects if credential is already `revoked`.
- [ ] T013 Implement and export `checkCredentialGovernanceLimits({ activeCredentialCount, perPrincipalLimit, perWorkspaceActiveCount, perWorkspaceLimit })` that returns `{ allowed: boolean, violatedLimit: string | null }`. Uses `STORAGE_CREDENTIAL_GOVERNANCE_DEFAULTS` when limits are `null`.
- [ ] T014 Implement and export `buildCredentialIntrospection({ credential })` that returns a safe read view (all metadata fields, no secret key material). The `accessKeyId` MAY appear; the secret access key MUST NOT.

---

## Phase 3 — Control-plane integration

- [ ] T015 Re-export `STORAGE_CREDENTIAL_STATES`, `STORAGE_CREDENTIAL_ERROR_CODES`, `STORAGE_CREDENTIAL_LIFECYCLE_EVENT_TYPES`, and `STORAGE_CREDENTIAL_GOVERNANCE_DEFAULTS` from `apps/control-plane/src/storage-admin.mjs` following the existing re-export conventions for other storage constants.
- [ ] T016 Implement and export `issueWorkspaceScopedCredential(input)` in `storage-admin.mjs` that: (a) validates `requestedScope` against the principal's effective permissions (using `validateCredentialScope`), (b) checks governance limits (using `checkCredentialGovernanceLimits`), (c) calls `buildScopedStorageCredential`, (d) returns `{ credential, lifecycleEvent }` where `lifecycleEvent` uses `CREATED` event type. Does NOT expose secret key material beyond the initial response envelope.
- [ ] T017 Implement and export `revokeWorkspaceScopedCredential(input)` in `storage-admin.mjs` that calls `revokeCredential` and returns `{ credential, lifecycleEvent }` with event type `REVOKED_EXPLICIT`. Validates that the acting principal holds workspace-admin, tenant-owner, superadmin, or credential-owner role.
- [ ] T018 Implement and export `initiateWorkspaceCredentialRotation(input)` in `storage-admin.mjs` that calls `initiateCredentialRotation` and returns `{ credential, lifecycleEvent }` with event type `ROTATION_INITIATED`.
- [ ] T019 Implement and export `confirmWorkspaceCredentialRotation(input)` in `storage-admin.mjs` that calls `confirmCredentialRotation` and returns `{ credential, lifecycleEvent }` with event type `ROTATION_CONFIRMED`.
- [ ] T020 Implement and export `cascadeRevokeWorkspaceCredentials({ credentials, trigger, actorPrincipal, workspaceId, tenantId, now })` in `storage-admin.mjs` that revokes all provided credentials and returns `{ revokedCredentials, lifecycleEvents }`. Event type MUST be `REVOKED_CASCADE_WORKSPACE` or `REVOKED_CASCADE_TENANT` depending on `trigger`.
- [ ] T021 Implement and export `cascadeRevokePrincipalCredentials({ credentials, principalId, actorPrincipal, workspaceId, tenantId, now })` in `storage-admin.mjs` that revokes all credentials for a removed principal and returns `{ revokedCredentials, lifecycleEvents }` with event type `REVOKED_CASCADE_PRINCIPAL`.
- [ ] T022 Implement and export `listWorkspaceScopedCredentials({ credentials, workspaceId, includeRevoked })` in `storage-admin.mjs` that returns a list of `buildCredentialIntrospection` views, filtering by workspace and optionally excluding revoked/expired states.
- [ ] T023 Implement and export `listTenantScopedCredentials({ credentialsByWorkspace, tenantId, includeRevoked })` in `storage-admin.mjs` that aggregates across all workspace credential lists and returns introspection views scoped to the tenant.

---

## Phase 4 — Unit tests (adapter)

- [ ] T024 Create `tests/unit/storage-scoped-credentials.test.mjs` using `node --test` pattern. Add describe/suite for `buildScopedStorageCredential`: verify required fields are present, `entityType` is `programmatic_storage_credential`, `lifecycleState` defaults to `active`, `expiresAt` is null when omitted, `rotationState` is null initially.
- [ ] T025 Add suite for `validateCredentialScope`: assert `valid: true` when requested scope is a strict subset; assert `valid: false` with non-empty `violations` when any action exceeds principal permissions; assert empty scope passes; assert full equality passes.
- [ ] T026 Add suite for `intersectCredentialScope`: verify the returned set equals the intersection; verify an empty principal set yields an empty intersection; verify no expansion beyond credential scope occurs.
- [ ] T027 Add suite for `initiateCredentialRotation`: assert state becomes `rotating`, `rotationState` is populated with `newKeyPairId` and `graceExpiresAt`; assert rejection when already in `rotating` state.
- [ ] T028 Add suite for `confirmCredentialRotation`: assert state returns to `active`, `rotationState` is cleared; assert rejection when credential is not `rotating`.
- [ ] T029 Add suite for `revokeCredential`: assert state becomes `revoked` from `active`; assert state becomes `revoked` from `rotating` (both key pairs coverage); verify idempotent call on already-revoked credential shape.
- [ ] T030 Add suite for `expireCredential`: assert state becomes `expired` from `active`; assert rejection when credential is `revoked`.
- [ ] T031 Add suite for `buildCredentialLifecycleEvent`: assert all required fields are present; assert secret key material is absent (scan returned object for any field containing 'secret' or 'key' values that could be a secret); assert `eventType` matches known event types.
- [ ] T032 Add suite for `checkCredentialGovernanceLimits`: assert `allowed: true` when under limit; assert `allowed: false` and `violatedLimit` populated when per-principal limit exceeded; assert `allowed: false` when per-workspace limit exceeded; assert platform defaults are used when limits are `null`.
- [ ] T033 Add suite for `buildCredentialIntrospection`: assert all metadata fields are present; assert no secret access key field appears in output; assert `accessKeyId` is present.

---

## Phase 5 — Unit tests (control-plane / storage-admin)

- [ ] T034 Extend `tests/unit/storage-admin.test.mjs` with a suite for `issueWorkspaceScopedCredential`: assert it returns `{ credential, lifecycleEvent }` with `CREATED` event type; assert scope-exceeds-permissions input returns a structured error referencing `CREDENTIAL_SCOPE_EXCEEDS_PRINCIPAL_PERMISSIONS`; assert governance-limit-exceeded input returns error referencing `CREDENTIAL_LIMIT_EXCEEDED`.
- [ ] T035 Add suite for `revokeWorkspaceScopedCredential`: assert `{ credential, lifecycleEvent }` returned with `REVOKED_EXPLICIT`; assert credential `lifecycleState` is `revoked`.
- [ ] T036 Add suite for `initiateWorkspaceCredentialRotation` and `confirmWorkspaceCredentialRotation`: assert state transitions and event types match spec (T027–T028 shapes at the control-plane layer).
- [ ] T037 Add suite for `cascadeRevokeWorkspaceCredentials`: assert all credentials in input are revoked; assert event types are `REVOKED_CASCADE_WORKSPACE` or `REVOKED_CASCADE_TENANT` per trigger value; assert audit events are emitted for each credential.
- [ ] T038 Add suite for `cascadeRevokePrincipalCredentials`: assert all credentials for the removed principal are revoked; assert event type is `REVOKED_CASCADE_PRINCIPAL`.
- [ ] T039 Add suite for `listWorkspaceScopedCredentials`: assert results are filtered to the specified workspace; assert active-only filter excludes revoked/expired credentials; assert introspection views contain no secret key material.
- [ ] T040 Add suite for `listTenantScopedCredentials`: assert results aggregate across workspaces; assert tenant boundary is respected (no cross-tenant leakage in output).

---

## Phase 6 — Adapter integration tests

- [ ] T041 Create `tests/adapters/storage-scoped-credentials.test.mjs`. Add integration-level suite that exercises the full issuance-to-revocation lifecycle using `buildScopedStorageCredential` → `buildCredentialLifecycleEvent` → `revokeCredential`: assert each state transition produces the correct record shape and lifecycle event.
- [ ] T042 Add suite verifying cross-workspace isolation: construct credentials for two distinct workspaces within the same tenant; assert `listWorkspaceScopedCredentials` for workspace W1 does not return credentials from workspace W2.
- [ ] T043 Add suite verifying rotation grace period semantics: initiate rotation, assert both old and new key pair IDs are recorded in credential; confirm rotation, assert only new key pair is canonical and `rotationState` is cleared.
- [ ] T044 Add suite verifying scope-intersection enforcement (`intersectCredentialScope`): issue a credential with broad scope, reduce principal permissions below credential scope, call `intersectCredentialScope`, assert effective scope reflects reduced permissions only.
- [ ] T045 Add suite verifying audit event cleanliness: call `buildCredentialLifecycleEvent` for each `STORAGE_CREDENTIAL_LIFECYCLE_EVENT_TYPES` value; for each event, assert no field value matches a pattern associated with secret key material.

---

## Phase 7 — Error taxonomy extension tests

- [ ] T046 Extend `tests/unit/storage-admin.test.mjs` (or create a focused suite) to assert each `STORAGE_CREDENTIAL_ERROR_CODES` value is non-empty, unique, and follows the existing error code naming convention used in `STORAGE_NORMALIZED_ERROR_CODES`.
- [ ] T047 Assert `STORAGE_CREDENTIAL_LIFECYCLE_EVENT_TYPES` values are non-empty, unique, and exported correctly from the adapter module.

---

## Phase 8 — Verification

- [ ] T048 Run `node --test tests/unit/storage-scoped-credentials.test.mjs` and `node --test tests/unit/storage-admin.test.mjs`; fix any deterministic failures introduced in Phases 4–5.
- [ ] T049 Run `node --test tests/adapters/storage-scoped-credentials.test.mjs`; fix any deterministic failures introduced in Phase 6.
- [ ] T050 Run full `npm test`; fix any follow-on regressions in existing storage tests (`storage-access-policy`, `storage-capacity-quotas`, `storage-admin`, `storage-event-notifications`, contract tests) before the branch is ready for push/PR/CI.
