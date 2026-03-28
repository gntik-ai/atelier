# Tasks: Storage Bucket Policies and Tenant/Workspace Permissions

**Input**: `specs/014-storage-bucket-policies-permissions/spec.md`, `specs/014-storage-bucket-policies-permissions/plan.md`  
**Task**: US-STO-02-T02  
**Branch**: `014-storage-bucket-policies-permissions`

## Sequential execution plan

- [x] T001 Write `specs/014-storage-bucket-policies-permissions/spec.md` with the bounded T02 feature specification.
- [x] T002 Write `specs/014-storage-bucket-policies-permissions/plan.md` with the repo-bound implementation plan.
- [x] T003 Write `specs/014-storage-bucket-policies-permissions/tasks.md` with the implementation checklist.

## Implementation checklist

- [x] T010 Create `services/adapters/src/storage-access-policy.mjs` — **catalog constants and additive error definitions first**:
  - `STORAGE_POLICY_EFFECTS` — frozen object with `{ ALLOW: 'allow', DENY: 'deny' }`.
  - `STORAGE_POLICY_PRINCIPAL_TYPES` — frozen object with `{ ROLE: 'role', USER: 'user', SERVICE_ACCOUNT: 'service_account' }`.
  - `STORAGE_POLICY_ACTIONS` — frozen catalog including at minimum: `object.get`, `object.put`, `object.delete`, `object.list`, `object.head`, `bucket.get_policy`, `multipart.initiate`, `multipart.upload_part`, `multipart.complete`, `multipart.abort`, `multipart.list`, `presigned.generate_download`, `presigned.generate_upload`.
  - `STORAGE_POLICY_SOURCES` — frozen object with `bucket_policy`, `workspace_default`, `builtin_default`, `superadmin_override`, `isolation_rejection`.
  - `STORAGE_POLICY_CONDITION_TYPES` — frozen object containing only the MVP condition `object_key_prefix`.
  - `STORAGE_POLICY_NORMALIZED_ERROR_CODES` — frozen catalog with additive entries for `BUCKET_POLICY_DENIED`, `BUCKET_POLICY_TOO_LARGE`, `BUCKET_POLICY_INVALID`, `BUCKET_POLICY_NOT_FOUND`; each entry must include `code`, `httpStatus`, `retryability: 'not_retryable'`, and non-empty `fallbackHint`.
  - Nested entries must also be frozen.

- [x] T011 Continue `services/adapters/src/storage-access-policy.mjs` — **statement and document validation helpers**:
  - `validateStoragePolicyStatement(input)` validates `effect`, non-empty `principals`, non-empty `actions`, and optional `conditions`.
  - `validateStoragePolicyDocument({ statements, maxStatements, maxBytes })` accepts an empty `statements` array, computes `statementCount` + `sizeBytes`, and rejects oversize payloads with `BUCKET_POLICY_TOO_LARGE` semantics.
  - MVP condition support is limited to `object_key_prefix`; unknown condition types must fail validation with `BUCKET_POLICY_INVALID` semantics.

- [x] T012 Continue `services/adapters/src/storage-access-policy.mjs` — **builders for policy-scoped entities**:
  - `buildStoragePolicyStatement(input)` returns a frozen normalized statement with deterministic `statementId`.
  - `buildStorageBucketPolicy({ tenantId, workspaceId, bucketId, statements, now, version })` returns `entityType: 'storage_bucket_policy'`, policy metadata, normalized statements, `statementCount`, `sizeBytes`, and timestamps.
  - `buildWorkspaceStoragePermissionSet({ tenantId, workspaceId, statements, now, version })` returns `entityType: 'workspace_storage_permissions'` using the same statement structure.
  - `buildTenantStoragePermissionTemplate({ tenantId, statements, now, version })` returns `entityType: 'tenant_storage_permission_template'`.
  - `buildSuperadminBucketPolicyOverride({ tenantId, workspaceId, bucketId, statements, originalPolicyId, superadminId, reason, now })` returns `entityType: 'superadmin_bucket_policy_override'` with source-policy linkage.
  - `buildStoragePolicyAttachmentSummary(input)` returns the optional bucket-facing summary record used by T017.

- [x] T013 Continue `services/adapters/src/storage-access-policy.mjs` — **workspace and tenant defaults**:
  - `buildBuiltInWorkspaceStorageDefaults()` returns the platform fallback permission set: standard object reads/writes/lists/heads allowed for workspace members; policy-management/admin-sensitive actions reserved to workspace admins.
  - `applyTenantStorageTemplateToWorkspace({ tenantTemplate, workspaceId, now })` clones the tenant template into a workspace default without mutating the source template.
  - Changes to the tenant template must not retroactively alter existing workspace defaults.

- [x] T014 Continue `services/adapters/src/storage-access-policy.mjs` — **principal and condition matching**:
  - `matchStoragePolicyPrincipal({ principal, actor })` supports role, user, and service-account identities.
  - `matchStoragePolicyCondition({ condition, objectKey })` supports `object_key_prefix` only.
  - `matchStoragePolicyStatement({ statement, actor, action, objectKey })` returns a deterministic match result including whether principal, action, and conditions matched.

- [x] T015 Continue `services/adapters/src/storage-access-policy.mjs` — **evaluation helpers with canonical precedence**:
  - `evaluateStoragePolicy({ policy, actor, action, objectKey })` enforces deny-wins across matching statements and implicit deny on no match.
  - `evaluateStorageAccessDecision({ isolationAllowed, bucketPolicy, workspaceDefault, builtinDefault, overridePolicy, actor, action, tenantId, workspaceId, bucketId, objectKey, managementOperation })` applies precedence in this exact order: isolation rejection → superadmin override → bucket policy → workspace default → built-in default.
  - `managementOperation` must preserve workspace-admin policy-management access even when the bucket policy would otherwise deny it.
  - Decision output must include `allowed`, `outcome`, `source`, `matchedStatementId`, `missingAction`, scoped ids, and optional `reasonCode`.

- [x] T016 Continue `services/adapters/src/storage-access-policy.mjs` — **audit/mutation builders**:
  - `buildStoragePolicyDecisionAuditEvent({ decision, actor, occurredAt, correlationId })` returns a frozen audit event capturing actor identity, action, bucket/object scope, policy source, matched statement or implicit-deny marker, and allow/deny outcome.
  - `buildStoragePolicyMutationAuditEvent({ operation, actor, previousPolicy, nextPolicy, tenantId, workspaceId, bucketId, occurredAt, correlationId })` returns a frozen audit event for attach/update/detach/override/remove-override operations.
  - Audit serialization must not leak secrets or URL-like values.

- [x] T017 Extend `services/adapters/src/storage-bucket-object-ops.mjs` additively:
  - Accept optional policy attachment input when building a bucket record.
  - Surface `policyAttachment` only when provided.
  - Preserve all existing bucket fields and assertions from specs `009`–`013`.

- [x] T018 Extend `services/adapters/src/provider-catalog.mjs` with additive re-exports from `storage-access-policy.mjs` (do not modify or remove existing exports):
  - constants: `storagePolicyEffects`, `storagePolicyPrincipalTypes`, `storagePolicyActions`, `storagePolicySources`, `storagePolicyConditionTypes`, `storagePolicyNormalizedErrorCodes`
  - builders: `buildStoragePolicyStatement`, `buildStorageBucketPolicy`, `buildWorkspaceStoragePermissionSet`, `buildTenantStoragePermissionTemplate`, `buildSuperadminBucketPolicyOverride`, `buildStoragePolicyAttachmentSummary`, `buildBuiltInWorkspaceStorageDefaults`, `applyTenantStorageTemplateToWorkspace`
  - validators / evaluators: `validateStoragePolicyStatement`, `validateStoragePolicyDocument`, `matchStoragePolicyPrincipal`, `matchStoragePolicyCondition`, `matchStoragePolicyStatement`, `evaluateStoragePolicy`, `evaluateStorageAccessDecision`
  - audit builders: `buildStoragePolicyDecisionAuditEvent`, `buildStoragePolicyMutationAuditEvent`

- [x] T019 Create `tests/unit/storage-access-policy.test.mjs` — **catalog and validation tests**:
  - constants and nested error definitions are frozen,
  - action catalog includes multipart and presigned actions from spec `013`,
  - malformed effects/principals/actions/conditions are rejected,
  - empty policy documents are valid and imply deny on evaluation,
  - oversize document / too many statements fail with `BUCKET_POLICY_TOO_LARGE`.

- [x] T020 Continue `tests/unit/storage-access-policy.test.mjs` — **evaluation tests**:
  - role-based allow and deny,
  - conflicting allow + deny => deny wins,
  - user-specific policy match,
  - service-account-specific policy match,
  - object-key-prefix condition match and mismatch,
  - no bucket policy => workspace default fallback,
  - no bucket policy and no workspace default => built-in default fallback,
  - superadmin override takes precedence,
  - isolation rejection happens before policy evaluation,
  - workspace-admin management access cannot be self-revoked.

- [x] T021 Continue `tests/unit/storage-access-policy.test.mjs` — **builder and audit tests**:
  - bucket policy/workspace default/tenant template/override builders return frozen normalized shapes,
  - `applyTenantStorageTemplateToWorkspace` clones rather than mutates,
  - decision and mutation audit events are frozen and do not leak sensitive substrings.

- [x] T022 Create `tests/adapters/storage-access-policy.test.mjs` — all adapter tests must import only from `provider-catalog.mjs`:
  - additive exports are defined,
  - decision evaluation behaves identically through the catalog surface,
  - bucket record `policyAttachment` summary is surfaced when provided,
  - multipart and presigned actions can be governed through the same policy evaluator,
  - policy-local error catalog remains additive.

- [x] T023 Extend `tests/contracts/storage-provider.contract.test.mjs` with an additive test block:
  - assert bucket policy/workspace default/tenant template/decision record structures,
  - assert `policyAttachment` is optional and additive on bucket records,
  - assert new policy-local error definitions do not collide with prior storage error catalogs,
  - do not modify existing assertions.

- [x] T024 Create `tests/e2e/storage-bucket-policies/README.md` — static scenario matrix covering:
  - bucket policy allow/deny,
  - workspace default fallback,
  - tenant template inheritance,
  - service-account evaluation,
  - superadmin override,
  - presigned URL generation-time evaluation,
  - multipart per-operation evaluation,
  - isolation rejection versus policy denial,
  - policy mutation auditing.

## Validation checklist

- [x] T030 Run `npm run lint:md`.
- [x] T031 Run `node --test tests/unit/storage-access-policy.test.mjs` — exit 0 required.
- [x] T032 Run `node --test tests/adapters/storage-access-policy.test.mjs` — exit 0 required.
- [x] T033 Run `node --test tests/adapters/provider-catalog.test.mjs` — exit 0 required (no regressions).
- [x] T034 Run `node --test tests/contracts/storage-provider.contract.test.mjs` — exit 0 required.
- [x] T035 Run `npm test` — exit 0 required.

## Delivery checklist

- [x] T040 Review git diff for T02 scope compliance: only `services/adapters/src/storage-access-policy.mjs` (new), additive changes in `services/adapters/src/storage-bucket-object-ops.mjs`, additive changes in `services/adapters/src/provider-catalog.mjs`, `tests/unit/storage-access-policy.test.mjs` (new), `tests/adapters/storage-access-policy.test.mjs` (new), additive block in `tests/contracts/storage-provider.contract.test.mjs`, `tests/e2e/storage-bucket-policies/README.md` (new), and `specs/014-storage-bucket-policies-permissions/` artifacts.
- [ ] T041 Commit the feature branch changes for `US-STO-02-T02`.
- [ ] T042 Push `014-storage-bucket-policies-permissions` to origin.
- [ ] T043 Open a PR to `main`.
- [ ] T044 Monitor CI, fix failures if needed, and merge when green.
