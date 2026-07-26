## Why

Confirmed audit finding C-25 / DEVOPS-08 shows that the deployed `falcone-control-plane`
receives `WEBHOOK_SIGNING_KEY` as literal workload environment data and that the audited values
override also stores the literal. This is not a disposable application setting: the control plane
normalizes it into the AES-256-GCM master key used to encrypt every persisted per-subscription
webhook signing secret, and the application currently substitutes a known development fallback when
the value is missing. A chart-only `secretKeyRef` edit would therefore risk making existing ciphertext
undecryptable while leaving install, upgrade, rotation, recovery, and rollback behavior unsafe.

The primary users are P18 platform installers/release engineers and P4 observability/security
operators who need a verifiable, secret-safe lifecycle. P3 platform administrators, P10 constrained
auditors, P12 machine actors, P13 cross-tenant adversarial actors, and P17 documentation consumers
must retain current authorization, isolation, webhook behavior, and usable recovery guidance.

## What Changes

- **BREAKING (deployment configuration):** replace every inline webhook master-key input with the
  umbrella-chart contract `global.webhookSigningKey`; reject the reserved `WEBHOOK_SIGNING_KEY` name
  in every chart-inspectable control-plane env/config route (`controlPlane.env`,
  `global.transportSecurity.env`, and `controlPlane.config.inline`); and inject exactly one required
  `valueFrom.secretKeyRef` with `optional: false`.
- Generate fresh-install managed keys inside the cluster as strict canonical-v1 material containing
  exactly 256 random bits. Reuse and validate an existing chart-owned Secret without mutation on
  normal upgrades, and support a read-only externally managed Secret with no chart mutation or
  deletion.
- Remove the development fallback in every environment. Before listening or becoming ready, apply
  additive migration `004`, strictly parse and resolve the configured key, verify its opaque identity
  and lifecycle state, and fail closed on missing, malformed, incompatible, incomplete, or ambiguous
  material.
- Preserve the existing global `DB_URL`/`PG*` control-plane pool and its tenant/workspace, saga,
  governance, and workspace-database duties. Authenticate webhook schema execution, ordinary
  webhook runtime reads, encrypted writes, and lifecycle maintenance through four additional,
  distinct bounded database logins and DSNs. A separate chart one-shot bootstrap, and only that
  bootstrap, receives the PostgreSQL administrator credential and owns LOGIN/NOLOGIN role creation,
  exact PostgreSQL 16 `ADMIN`/`INHERIT`/`SET` bindings under a declared durable grantor,
  legacy-membership repair, credential persistence, and enumerated webhook-object ownership
  transfer. Application migration replay validates the pre-created graph and deterministically
  reconciles exact object ACL/function/RLS policy state, including complete dependent object-ACL
  chains through owner-issued `CASCADE` at only the enumerated object/grantee boundary; it cannot
  create roles or repair role memberships made by another grantor. Every pool verifies
  `session_user = current_user`, rejects
  privileged/startup-role aliases, and neither the global nor webhook runtime login owns the
  signing table or can assume either fixed authority.
- Make ordinary runtime webhook permissions explicit in migration `004` for both migration-003/RLS
  present and absent deployments. Runtime retains tenant-scoped reads and non-secret operations but
  cannot read lifecycle state or insert/update encrypted signing-secret columns; those writes remain
  exclusive to the dedicated writer pool and fixed writer authority. Adapter construction rejects a
  missing writer pool, a shared runtime/writer object, or a global-control-plane pool alias before
  persistence.
- Add explicit, idempotent maintenance operations for legacy adoption, canonical rotation, recovery,
  and finalization. Rotation quiesces webhook consumers and atomically decrypts and re-encrypts all
  existing `webhook_signing_secrets` rows under a new Secret name/key identity while preserving exact
  plaintext and row/tenant/workspace semantics.
- Keep only non-secret lifecycle identity/state plus a key-verification ciphertext/IV in the database.
  Keep idempotency, sanitized audit, counts, timestamps, and recovery deadlines in a dedicated
  rotation ledger; never store key bytes or key digests there.
- Expose secret-safe reference and lifecycle posture to P4 without granting Kubernetes Secret-data
  access. Prevent key bytes from appearing in workload specs, ConfigMaps, Helm values/history/rendered
  YAML, logs, metrics, Events, CLI arguments, evidence, or lifecycle metadata.
- Preserve per-subscription signing-secret plaintext, outbound public webhook signatures, tenant and
  workspace isolation, quotas, authorization, and public API contracts. The platform master-key
  lifecycle is an operator maintenance CLI, not a tenant API.
- Deliver the compatible Falcone application/image first, then the chart values/schema/templates,
  least-privilege credential hook/RBAC, release, and Falcone `FALCONE_CHARTS_REF` pin. Document and
  verify legacy adoption, a later separate canonical rotation, recovery, and finalization.

## Capabilities

### New Capabilities

- `operations`: define the PostgreSQL 16 minimum, exact durable role-edge/grantor contract,
  global-versus-webhook pool boundary, enumerated ownership-transfer handoff, and fail-closed
  authorization-drift recovery procedure.

### Modified Capabilities

- `deployment`: define secret-only chart input, in-cluster generation/validation, immutable Secret
  custody, secret-safe rollout/posture, and cross-repository install/upgrade/rollback behavior.
- `webhooks`: define strict runtime key resolution, additive lifecycle persistence, transactional
  adoption/rotation/recovery/finalization, and preservation of webhook data and tenant behavior.

## Scope and Non-Goals

This change is bounded to C-25: custody and lifecycle of the webhook AES-GCM platform master key. It
does not add a UI, OpenAPI/SDK/gateway/public-auth contract, Kafka contract, public audit schema,
tenant role, KMS/ESO/Vault integration, or general-purpose secret controller. It does not change the
tenant-facing per-subscription secret-rotation API.

Kubernetes Secret RBAC, etcd encryption and backup custody, node/runtime access, and authorized
`exec` access remain operator responsibilities outside this reference fix. The chart cannot prevent
an external secret manager from mutating referenced data in place; such same-name/in-place rotation
is unsupported and rejected by lifecycle identity checks.

## Operational Risks, Rollback, and Exit Criteria

- Adoption and rotation require a declared maintenance window, a tested database backup, custody of
  the source/recovery Secret, and quiescence of every process that can encrypt or decrypt webhook
  signing-secret rows. Backup restore and key recovery are coupled: restoring ciphertext without its
  matching retained key identity is not recoverable by the application.
- Managed current and recovery Secrets are retained through upgrade and uninstall until explicit,
  bounded finalization; external Secrets are never mutated or deleted. Every rotation uses a new
  Secret name/key identity.
- Helm history can retain the old inline value, and `helm rollback` to a revision that renders
  `env.value` can both re-expose the key and roll the application back across a data-key transition.
  The supported rollback is a forward operation with the fixed chart's idempotent `recover` action,
  never rollback to an unsafe Helm revision.
- The change exits when fresh install, no-op upgrade, external-Secret validation, legacy adoption,
  canonical rotation, failure-before-commit, ambiguous-after-commit recovery, finalization, and
  secret-leak negative cases pass on disposable kind and OpenShift-compatible installations; tenant
  isolation, quotas, authorization, public webhook signatures, and public API contracts remain green.

## Impact

- Falcone application: webhook key parsing/identity/lifecycle helpers, startup/readiness gating,
  maintenance CLI, webhook crypto consumers, additive migration `004`, database adapter, image and
  tests.
- `falcone-charts`: umbrella global values and schema, alias-aware control-plane injection and rollout
  annotations, reserved-env validation, credential lifecycle hook Job, least-privilege RBAC, profiles,
  chart tests, version, and release notes.
- Operations and documentation: maintenance-window runbook, backup/recovery coupling, external-manager
  constraints, secret-safe verification, Helm-history hazard, cross-repository release ordering, and
  the C-25 audit matrix/finding closure evidence.
- Public REST, UI, SDK, gateway, tenant authorization, quotas, and externally observed webhook
  signature format remain unchanged.
