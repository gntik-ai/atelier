# Implementation Plan: US-STO-02-T02 — Storage Bucket Policies and Tenant/Workspace Permissions

**Feature Branch**: `014-storage-bucket-policies-permissions`
**Spec**: `specs/014-storage-bucket-policies-permissions/spec.md`
**Task**: US-STO-02-T02
**Epic**: EP-12 — Storage S3-compatible
**Status**: Ready for implementation
**Created**: 2026-03-28

---

## 1. Scope Summary

This task introduces a platform-level, declarative storage authorization layer for buckets and bucket-adjacent operations. The delivery is **additive only**: it adds a new pure-functional storage policy module, additive re-exports through `provider-catalog.mjs`, targeted tests, and a static E2E scenario matrix. Published contracts from specs `007`–`013` remain intact.

The implementation is intentionally **platform-evaluated**, not provider-native:
- bucket policies are evaluated by Falcone before the request reaches the S3-compatible backend,
- workspace defaults govern buckets with no attached bucket policy,
- tenant templates seed workspace defaults at workspace creation time,
- superadmin overrides temporarily supersede bucket policies without deleting the underlying policy.

The repo-local implementation should stay consistent with prior storage tasks: pure builders, immutable return values, normalized error envelopes, deterministic previews, and no live provider I/O.

---

## 2. Dependency Map

| Prior task | Spec | Module / surface | What this task consumes |
|---|---|---|---|
| T01 — Provider abstraction | `007` | `storage-provider-profile.mjs` | Provider capability framing and additive catalog conventions |
| T02 — Tenant context | `008` | `storage-tenant-context.mjs` | Tenant/workspace scope data for template inheritance and isolation context |
| T03 — Bucket/object ops | `009` | `storage-bucket-object-ops.mjs` | Bucket record shape, object operation vocabulary, storage mutation event conventions |
| T04 — Logical organization | `010` | `storage-logical-organization.mjs` | Object-key prefix semantics used by policy conditions |
| T05 — Error taxonomy | `011` | `storage-error-taxonomy.mjs` | Normalized error envelope structure, redaction behavior, retryability model |
| T06 — Verification suite | `012` | `storage-provider-verification.mjs` | Additive-contract discipline for test coverage |
| T01 sibling — Multipart/presigned | `013` | `storage-multipart-presigned.mjs` | Additional governed actions: `multipart.*` and `presigned.*` |

---

## 3. Planned Artifacts

### 3.1 New core module

**`services/adapters/src/storage-access-policy.mjs`**

Create a new pure-functional module that owns the bucket/workspace/tenant policy model.

Planned exports:

```text
// Catalog constants
STORAGE_POLICY_EFFECTS
STORAGE_POLICY_PRINCIPAL_TYPES
STORAGE_POLICY_ACTIONS
STORAGE_POLICY_SOURCES
STORAGE_POLICY_CONDITION_TYPES
STORAGE_POLICY_NORMALIZED_ERROR_CODES

// Builders / validators
buildStoragePolicyStatement(input)
validateStoragePolicyStatement(input)
validateStoragePolicyDocument(input)
buildStorageBucketPolicy(input)
buildWorkspaceStoragePermissionSet(input)
buildTenantStoragePermissionTemplate(input)
buildSuperadminBucketPolicyOverride(input)
buildStoragePolicyAttachmentSummary(input)
buildBuiltInWorkspaceStorageDefaults(input)
applyTenantStorageTemplateToWorkspace(input)

// Evaluation helpers
matchStoragePolicyPrincipal(input)
matchStoragePolicyCondition(input)
matchStoragePolicyStatement(input)
evaluateStoragePolicy(input)
evaluateStorageAccessDecision(input)

// Audit / mutation builders
buildStoragePolicyDecisionAuditEvent(input)
buildStoragePolicyMutationAuditEvent(input)
```

Design constraints:
- no I/O, no network calls, no S3 SDK,
- all public builders return frozen plain objects,
- validation failures are deterministic and additive,
- deny-wins semantics are enforced inside the evaluation layer,
- conditions required for MVP are limited to `object_key_prefix`,
- workspace admin lockout protection and superadmin override precedence are handled explicitly.

### 3.2 Additive bucket-shape extension

**`services/adapters/src/storage-bucket-object-ops.mjs`**

Add an optional policy attachment summary to bucket records without breaking the existing bucket contract. The field must be absent unless input policy attachment data is provided.

Candidate additive field:

```text
policyAttachment?: {
  policyId: string
  source: 'bucket_policy' | 'superadmin_override'
  statementCount: number
  updatedAt: string
  overrideActive: boolean
}
```

This satisfies the spec requirement that the bucket entity can carry an optional policy attachment reference while preserving backward compatibility.

### 3.3 Additive provider catalog exports

**`services/adapters/src/provider-catalog.mjs`**

Re-export the new policy builders/evaluators through stable storage-prefixed names so downstream callers can consume the storage policy surface without importing the new module directly.

### 3.4 Tests

Create / update:
- `tests/unit/storage-access-policy.test.mjs`
- `tests/adapters/storage-access-policy.test.mjs`
- `tests/contracts/storage-provider.contract.test.mjs` (additive block only)
- `tests/e2e/storage-bucket-policies/README.md`

---

## 4. Data Model and Evaluation Shape

### 4.1 Policy statement

Each statement should normalize to:

```text
{
  statementId: string
  effect: 'allow' | 'deny'
  principals: [
    { type: 'role' | 'user' | 'service_account', value: string }
  ]
  actions: string[]
  conditions: [
    { type: 'object_key_prefix', value: string }
  ]
}
```

### 4.2 Bucket policy

```text
{
  entityType: 'storage_bucket_policy'
  policyId: string
  tenantId: string
  workspaceId: string
  bucketId: string
  version: number
  statements: StoragePolicyStatement[]
  sizeBytes: number
  statementCount: number
  lifecycleState: 'active' | 'orphaned'
  timestamps: { createdAt: string, updatedAt: string }
}
```

### 4.3 Workspace default and tenant template

Use the same statement structure as bucket policies, with distinct entity types and scope keys:
- `workspace_storage_permissions`
- `tenant_storage_permission_template`

The built-in default should be generated by a builder rather than hard-coded inline throughout tests. It should allow standard object operations for members and reserve admin-only actions for workspace admins.

### 4.4 Decision result

```text
{
  allowed: boolean
  outcome: 'allow' | 'deny'
  source: 'bucket_policy' | 'workspace_default' | 'builtin_default' | 'superadmin_override' | 'isolation_rejection'
  matchedStatementId: string | null
  missingAction: string | null
  actor: { type: string, id: string, roles: string[] }
  action: string
  tenantId: string
  workspaceId: string
  bucketId: string
  objectKey?: string
  reasonCode?: string
}
```

`evaluateStorageAccessDecision` should implement the canonical precedence:
1. isolation rejection,
2. superadmin override (if active),
3. bucket policy,
4. workspace default,
5. built-in default.

---

## 5. Error Model

Add new policy-local error definitions in `storage-access-policy.mjs`, keeping them additive and non-colliding with prior catalogs:
- `BUCKET_POLICY_DENIED`
- `BUCKET_POLICY_TOO_LARGE`
- `BUCKET_POLICY_INVALID`
- `BUCKET_POLICY_NOT_FOUND`

Each definition should include:
- `code`
- `httpStatus`
- `retryability: 'not_retryable'`
- `fallbackHint`

When helpful, map policy validation errors into a storage-error-envelope-compatible record so callers can reuse the existing normalized error conventions.

---

## 6. Test Strategy

### 6.1 Unit tests — `tests/unit/storage-access-policy.test.mjs`

Cover at minimum:
- frozen constant catalogs and additive error definitions,
- statement validation for malformed effect, principal, action, and condition values,
- empty policy acceptance with implicit deny semantics,
- size / statement-count limit enforcement,
- deny-wins behavior with conflicting allow+deny statements,
- role-based, user-based, and service-account-based matching,
- object-key-prefix conditions,
- workspace-default fallback when no bucket policy exists,
- built-in default fallback when no workspace default exists,
- superadmin override precedence,
- workspace admin lockout protection for policy management operations,
- tenant-template application to new workspace defaults,
- audit-event redaction / immutability expectations.

### 6.2 Adapter tests — `tests/adapters/storage-access-policy.test.mjs`

Import only from `provider-catalog.mjs` and verify:
- new builders are exported and defined,
- policy evaluation behaves the same through the catalog surface,
- bucket record additive policy attachment summary is preserved,
- multipart and presigned actions are accepted in the action catalog,
- no raw secrets or URLs leak into policy audit payloads.

### 6.3 Contract tests — `tests/contracts/storage-provider.contract.test.mjs`

Add one bounded additive block asserting:
- bucket policy records, workspace defaults, tenant templates, and decision records are structurally valid,
- the new policy-local error catalog does not collide with prior storage error catalogs,
- the bucket record optional `policyAttachment` field is additive and non-breaking.

### 6.4 Static E2E matrix — `tests/e2e/storage-bucket-policies/README.md`

Document scenario matrices for:
- bucket policy allow/deny,
- workspace default fallback,
- tenant template inheritance,
- service-account evaluation,
- superadmin override,
- isolation rejection vs policy denial,
- presigned and multipart action governance,
- policy mutation auditing.

---

## 7. Execution Sequence

1. Create `storage-access-policy.mjs` with constant catalogs, error definitions, and basic validators.
2. Add policy document builders and attachment summaries.
3. Implement evaluation helpers with deny-wins precedence and fallback ordering.
4. Add audit/mutation event builders.
5. Extend `storage-bucket-object-ops.mjs` with the optional bucket policy attachment summary.
6. Extend `provider-catalog.mjs` with additive exports only.
7. Write unit tests.
8. Write adapter tests.
9. Extend contract tests.
10. Add the static E2E scenario matrix.
11. Run focused validation, then full repo validation.

---

## 8. Validation Commands

Preferred validation path for this task:

```bash
npm run lint:md
node --test tests/unit/storage-access-policy.test.mjs
node --test tests/adapters/storage-access-policy.test.mjs
node --test tests/adapters/provider-catalog.test.mjs
node --test tests/contracts/storage-provider.contract.test.mjs
npm test
```

If a broader `node --test` directory invocation is flaky in this repo, prefer the explicit file-level commands above plus `npm test`.

---

## 9. Risks and Controls

- **Over-scoping into live API wiring**: keep this bounded to the existing repo pattern of pure builders/evaluators and additive catalog exports.
- **Breaking existing bucket contract**: only add an optional `policyAttachment` field when input data is present.
- **Authorization ambiguity**: centralize precedence in one evaluation helper; do not duplicate logic across tests.
- **Policy lockout**: encode workspace-admin management bypass explicitly and test it.
- **Template retroactivity drift**: apply tenant templates only through the workspace-seeding helper; do not mutate existing workspace defaults.

---

## 10. Delivery Notes

This plan is intentionally conservative and repo-faithful. It provides the policy model, evaluation semantics, and audit-ready records needed by the next implementation step without forcing live provider integration or cross-cutting API rewiring in the same task.
