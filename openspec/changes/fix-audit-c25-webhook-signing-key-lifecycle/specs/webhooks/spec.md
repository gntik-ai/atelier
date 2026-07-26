## ADDED Requirements

### Requirement: Webhook master-key parsing is strict and has no fallback

The system SHALL resolve webhook master-key material once into a key context containing bytes, the
declared mode, and the opaque `WEBHOOK_SIGNING_KEY_ID`. Canonical-v1 parsing SHALL accept only `v1:`
plus the 43-character unpadded base64url encoding of exactly 32 bytes. Historical
32-byte-or-SHA-256 normalization SHALL be callable only by an explicit legacy adoption or recovery
state. Missing, empty, malformed, incompatible, wrong-identity, or unverifiable material SHALL fail
closed in every environment, and the system SHALL NOT use `development-signing-key` or any other
default.

#### Scenario: Canonical-v1 key resolves to exactly 32 bytes

- **WHEN** `WEBHOOK_SIGNING_KEY` is strict canonical-v1 material and the declared mode/opaque identity match lifecycle state
- **THEN** the resolved key context contains the exact decoded 32 bytes and is eligible for lifecycle verification

#### Scenario: Missing key has no development fallback

- **WHEN** `WEBHOOK_SIGNING_KEY` is missing or empty in development, test, staging, or production
- **THEN** key resolution fails closed before any webhook secret is encrypted/decrypted and no default string is substituted

#### Scenario: Malformed canonical input is not normalized

- **WHEN** canonical input contains padding, whitespace, an alternate alphabet, the wrong encoded/decoded length, trailing data, an unknown version, or a non-round-tripping encoding
- **THEN** parsing rejects it and never hashes or truncates it into an AES key

#### Scenario: Legacy normalization is unavailable during ordinary serving

- **WHEN** arbitrary legacy string material is supplied while lifecycle mode is canonical-v1 or no explicit legacy adoption/recovery is active
- **THEN** the system rejects the material and does not attempt historical SHA-256 normalization

#### Scenario: Stable identity with changed external bytes fails verification

- **WHEN** the namespace/Secret/key identity is unchanged but the supplied bytes cannot authenticate the lifecycle verification ciphertext
- **THEN** key verification fails closed and the consumer does not listen, become ready, or access subscription ciphertext

### Requirement: Migration 004 records non-secret webhook master-key lifecycle state

The system SHALL apply an additive, idempotent migration 004 that adds `encryption_key_id` to
`webhook_signing_secrets`, creates singleton `webhook_master_key_state`, and creates the idempotency and
audit ledger `webhook_master_key_rotations`. The state SHALL contain only non-secret key identities,
modes, lifecycle/recovery state, deadline, and key-verification ciphertext/IV. The ledger SHALL contain
only action, request/rotation IDs, source/target identities, state, bounded row counts, timestamps,
recovery deadline, and sanitized errors; neither table SHALL contain key bytes, encoded keys, key
digests, or decrypted subscription secrets.

The existing global `DB_URL`/`PG*` pool SHALL remain responsible for tenant/workspace, saga,
governance, saga recovery, and workspace-database operations and SHALL NOT be injected into webhook
adapters. Before application DDL, a separate chart one-shot PostgreSQL bootstrap SHALL require
PostgreSQL 16 or newer and create or validate the distinct webhook schema, runtime, writer, and
lifecycle `LOGIN`s and the fixed `NOLOGIN` authorities `falcone_app`,
`falcone_webhook_key_lifecycle`, and `falcone_webhook_key_writer`. It SHALL use the bundled
PostgreSQL administrative credential only inside that Job to repair legacy/implicit memberships
under one declared durable administrator grantor and bind exactly `falcone_app` to runtime with
`ADMIN FALSE, INHERIT TRUE, SET FALSE`, `falcone_webhook_key_writer` to writer with
`ADMIN FALSE, INHERIT FALSE, SET TRUE`, and `falcone_webhook_key_lifecycle` to lifecycle with
`ADMIN FALSE, INHERIT FALSE, SET TRUE`. That administrative credential SHALL never be mounted in or
injected into the long-running control-plane or lifecycle Job.

Migration 004 SHALL require the fixed roles, exact PostgreSQL 16 edge options, and exact grantor to
have been pre-provisioned, validate their bounded attributes, and fail closed when the contract is
absent or invalid. It SHALL NOT create or alter global roles, grant or revoke role membership,
repair an implicit creator membership, or claim it can revoke a membership granted by another
grantor. On its own enumerated webhook objects it SHALL first revoke PUBLIC, fixed-authority,
unexpected-grantee, column, and function-execution excess, then grant only the exact allowlist. The
bounded schema owner SHALL have no `CREATEROLE`, superuser, `BYPASSRLS`, `CREATEDB`, or replication
authority and SHALL hold no runtime, writer, or lifecycle membership.

Migration 004 SHALL grant `falcone_app` the tenant-scoped webhook reads and non-secret ordinary
operations required by the control plane in both the migration-003/FORCE-RLS-present and
migration-003/RLS-absent paths. Runtime SHALL have no lifecycle-table access and no privilege to
insert or update encrypted signing-secret columns. Writer and lifecycle authority SHALL remain
separate and limited to their respective fixed roles.

The lifecycle `LOGIN` SHALL have no direct lifecycle-table grant under its `INHERIT FALSE` binding.
Every lifecycle-repository read, including resolution state, operator status, and already-quiesced
replay authorization, SHALL lease one connection, begin a read-only transaction, execute
`SET LOCAL ROLE falcone_webhook_key_lifecycle`, perform all related reads on that client, and commit
or roll back before releasing it. Read primitives used inside a lifecycle mutation SHALL reuse the
mutation's existing client and SHALL NOT begin a nested transaction or issue a pool query. The
transaction-local role and read-only state SHALL NOT leak to later pooled work.

With migration 003 present, all four tenant webhook relations SHALL have RLS and FORCE RLS enabled
and SHALL contain only the seven named, role-bound, permissive policies and exact tenant/lifecycle
predicates declared by the migrations. With migration 003 absent, those relations SHALL remain
without RLS and no policy SHALL survive. Lifecycle relations SHALL remain without RLS. Post-DDL
startup and lifecycle verification SHALL check exact ownership, relation/function ACLs and grantors,
absence of column privileges, RLS flags, and complete policy inventory and definitions.

#### Scenario: Migration is additive on a legacy database

- **WHEN** migration 004 is applied to a database with existing `webhook_signing_secrets` rows
- **THEN** all existing webhook rows and public data remain present, the new identity column and lifecycle tables exist, and no key identity is guessed or backfilled without explicit adoption

#### Scenario: Migration replay reconciles authorization exactly

- **WHEN** migration 004 runs more than once during restart, retry, or upgrade, including after excessive writer/lifecycle/PUBLIC grants, an unexpected grantee/column grant, PUBLIC function execution, or an alternate permissive policy is injected
- **THEN** it completes without duplicate objects or lifecycle-state mutation, removes all authorization excess, recreates only the exact policy/ACL allowlist for the selected RLS variant, and passes full post-DDL verification

#### Scenario: Lifecycle verification stores ciphertext rather than a digest

- **WHEN** a current or recovery key is registered in lifecycle state
- **THEN** the system writes a fresh-IV authenticated encryption of the fixed verification sentinel and stores no digest or reversible representation of the key

#### Scenario: Rotation ledger is idempotent and secret-free

- **WHEN** adoption, rotation, recovery, or finalization records an outcome
- **THEN** the ledger uniquely binds the request/action/identities and records only sanitized metadata, counts, timestamps, deadline, and error state without key-derived or decrypted material

#### Scenario: Tenant database path cannot access platform lifecycle operations

- **WHEN** a normal webhook management or delivery operation uses its tenant-scoped database adapter
- **THEN** it can access only the tenant/workspace webhook rows needed by that operation and cannot read or mutate platform master-key lifecycle state/ledger through that adapter

#### Scenario: Existing ordinary role does not inherit lifecycle authority

- **WHEN** migration 004 is applied or replayed on an installation where `falcone_app` already exists
- **THEN** `falcone_app` and the schema executor retain no writer/lifecycle-role membership, `falcone_app` has no lifecycle-table privilege, and all three fixed authorities remain non-login, non-superuser, non-`BYPASSRLS`, and independently testable

#### Scenario: Global and four webhook database principals remain distinct

- **WHEN** the global control plane, webhook schema migration, ordinary webhook serving, encrypted writes, and key lifecycle maintenance connect for startup or maintenance
- **THEN** `session_user` equals the initial `current_user` on every connection, all five authenticated users are pairwise distinct, all four webhook users are bounded and match their declared LOGIN names, the global pool retains non-webhook schemas/saga recovery/workspace-database duties but cannot enter webhook adapters or assume writer/lifecycle authority, and neither runtime login owns `webhook_signing_secrets`

#### Scenario: Startup-role aliases over one privileged session are rejected

- **WHEN** schema, runtime, writer, and lifecycle pools authenticate through one administrator or superuser session and select different startup roles as `current_user`
- **THEN** both full startup verification and lifecycle-only verification fail before DDL, a lifecycle transaction, readiness, or listen

#### Scenario: Chart bootstrap owns global authority changes

- **WHEN** a fixed role, exact direct membership, PostgreSQL 16 option, durable grantor, or protected-graph edge is missing, excessive, implicit, or ambiguous
- **THEN** application migration and startup fail with a bounded configuration error and do not create, alter, grant, revoke, repair, or reprovision any global role

#### Scenario: Runtime ordinary operations are production-real with or without RLS migration

- **WHEN** migration 004 is applied after migrations 001/002 with migration 003 either present or absent
- **THEN** the runtime login can perform the required tenant-scoped subscription and delivery reads/non-secret mutations through `falcone_app`, cannot read lifecycle state, cannot insert or update encrypted signing-secret columns, and no fixture-only grant is required

#### Scenario: Bounded lifecycle reads assume authority without session leakage

- **WHEN** the distinct lifecycle LOGIN calls resolution state, operator status, or already-quiesced replay authorization
- **THEN** direct reads as the LOGIN remain denied with SQLSTATE `42501`, each repository method reads only after transaction-local assumption of `falcone_webhook_key_lifecycle`, replay mismatches fail closed, commit/rollback releases the connection, and later pooled work again observes `session_user = current_user = <lifecycle-login>` with no direct lifecycle-table access

### Requirement: Webhook consumers verify schema, key identity, and lifecycle before serving

The system SHALL await webhook schema migration, strict key resolution, lifecycle-state validation,
opaque identity matching, and verification-cipher authentication before `server.listen`, readiness, or
consumer processing. A canonical key MAY initialize absent singleton state only when the database has
no signing-secret rows. A database with existing rows but no complete lifecycle state SHALL require
explicit adoption. Incomplete, in-progress, expired, ambiguous, or `recovery_required` state SHALL
remain fail-closed.

#### Scenario: Empty fresh database initializes safely

- **WHEN** startup has a valid canonical-v1 key and the database has neither signing-secret rows nor master-key state
- **THEN** the system atomically initializes canonical current identity/verification state and listens only after that state verifies

#### Scenario: Existing rows without lifecycle state require adoption

- **WHEN** startup finds one or more signing-secret rows but no complete master-key state or missing row `encryption_key_id` values
- **THEN** startup fails closed with a sanitized adoption-required state and does not infer a key or listen

#### Scenario: Rotation or recovery ambiguity blocks readiness

- **WHEN** lifecycle state is `rotation_in_progress`, `recovery_required`, has conflicting row key identities, or otherwise cannot prove one serving key
- **THEN** the server and every webhook consumer remain stopped or unready and perform no webhook encryption/decryption

#### Scenario: Verified lifecycle permits serving

- **WHEN** migration, strict parsing, opaque identity, verification ciphertext, row key identities, and lifecycle state all agree on one serving key
- **THEN** the server may listen/become ready and all webhook crypto consumers use the single resolved key context

#### Scenario: Schema or key verification failure precedes listen

- **WHEN** schema application, key lookup, format validation, identity verification, or lifecycle reconciliation fails
- **THEN** no network listener or ready endpoint advertises successful service and Kubernetes can restart or hold the workload for operator recovery

### Requirement: Legacy webhook master-key adoption is explicit and atomic

The system SHALL adopt historical arbitrary-string material only through an explicit
`adoption.mode=legacy` maintenance operation with a unique request ID. The operation SHALL quiesce all
webhook master-key consumers, acquire exclusive advisory and transaction locks, verify every existing
row using the exact historical 32-byte-or-SHA-256 normalization, assign the declared opaque key
identity, and atomically establish legacy serving/verification state without changing per-subscription
plaintext. It SHALL NOT rotate implicitly to canonical-v1.

#### Scenario: Explicit legacy adoption preserves every secret

- **WHEN** all existing rows decrypt with the exact supplied historical material and the database has no conflicting lifecycle state
- **THEN** one transaction labels every row with the legacy key identity, establishes verified legacy serving state, and preserves each row's exact plaintext and all non-key columns

#### Scenario: Successful adoption retry is idempotent

- **WHEN** the same adoption request ID and key identity are submitted after that request committed
- **THEN** the operation returns the recorded result without decrypting, relabeling, or otherwise mutating rows again

#### Scenario: Adoption request ID cannot be rebound

- **WHEN** an existing adoption request ID is reused with a different action, mode, or key identity
- **THEN** the operation rejects the conflict and leaves established state and rows unchanged

#### Scenario: One incompatible row aborts adoption

- **WHEN** any existing row cannot be authenticated/decrypted with the declared historical material or rows reflect mixed/unknown key state
- **THEN** the transaction rolls back all row/state changes, records only a sanitized failure, and the database remains non-serving until corrected

#### Scenario: Legacy adoption does not perform canonical rotation

- **WHEN** explicit legacy adoption succeeds
- **THEN** lifecycle mode remains legacy with the exact historical normalized key and canonical rotation requires a later distinct request and new Secret identity

### Requirement: Platform master-key rotation is quiesced, transactional, and idempotent

The system SHALL expose platform master-key rotation only through the maintenance CLI/hook. Every
rotation SHALL use a source and a different target Secret name/key identity, quiesce and verify all
consumers, acquire an advisory/transaction lock, decrypt and re-encrypt every
`webhook_signing_secrets` row in one transaction, and atomically commit the target current identity,
source recovery identity, verification state, counts, and recovery deadline. It SHALL preserve exact
plaintext and every row ID, subscription ID, tenant/workspace ID, status, grace/revocation timestamp,
and other non-encryption field. The lifecycle repository SHALL execute
`SET LOCAL ROLE falcone_webhook_key_lifecycle` before the exclusive fence. Ordinary encrypted writes
SHALL run through a separate writer pool whose authenticated login alone can assume
`falcone_webhook_key_writer`; no caller-controlled key-ID GUC SHALL authorize a write. Encrypted-row
trigger bypass SHALL require both the exclusive lock and
an authorized effective `current_user` (the dedicated lifecycle role, effective table owner, or
effective superuser); `session_user`, role membership without effective assumption, caller-controlled
settings, and advisory-lock shape alone SHALL NOT confer lifecycle authority.

#### Scenario: Canonical rotation preserves data and behavior

- **WHEN** a verified legacy or canonical source rotates to a distinct valid canonical-v1 target while all consumers are quiesced
- **THEN** every row is re-encrypted with a fresh IV under the target, verification proves exact plaintext preservation, all non-encryption fields are unchanged, and target/current plus source/recovery state commits atomically

#### Scenario: Rotation cannot start while a consumer is active

- **WHEN** the maintenance operation cannot quiesce or prove the drain of every process that can encrypt or decrypt webhook signing secrets
- **THEN** it refuses to transform any row and leaves source serving state unchanged

#### Scenario: Constrained exclusive-lock holder cannot impersonate lifecycle

- **WHEN** the actual runtime login executes `SET LOCAL ROLE falcone_app`, supplies the real current key ID through caller-controlled settings and row labels, acquires the lifecycle exclusive advisory lock, and attempts a wrong-key encrypted-row INSERT or UPDATE
- **THEN** the security-invoker trigger evaluates the effective constrained role and rejects the write with bounded SQLSTATE `55000`, without changing any signing-secret row or gaining lifecycle-table access

#### Scenario: Authorized least-privilege executor retains lifecycle behavior

- **WHEN** the distinct dedicated maintenance login effectively assumes `falcone_webhook_key_lifecycle`, quiesces consumers, and acquires the exclusive serialization fence
- **THEN** adopt, rotate, recover, and finalize can transform the intended signing rows and lifecycle state atomically through the role's relation-scoped grants and RLS policy

#### Scenario: Dedicated encrypted writer remains usable

- **WHEN** the distinct writer login assumes `falcone_webhook_key_writer`, verifies the durable current identity, and performs an adapter-owned atomic subscription plus encrypted-secret write
- **THEN** the write commits under the shared fence without granting the runtime or schema login writer membership

#### Scenario: Same-identity rotation is rejected

- **WHEN** source and target resolve to the same namespace/Secret/key identity
- **THEN** rotation fails before row access even if an external manager changed the bytes behind that identity

#### Scenario: Failure before commit restores source serving

- **WHEN** key verification, row decryption/re-encryption, validation, lock/timeout, or database work fails before transaction commit
- **THEN** PostgreSQL rolls back every transformed row and lifecycle change, the old source remains authoritative, and source serving can resume without partial migration

#### Scenario: Ambiguous post-commit outcome fails closed

- **WHEN** commit acknowledgement, hook completion, or consumer rollout is lost or ambiguous after the transaction may have committed
- **THEN** lifecycle is reconciled as `recovery_required`, no source or target consumer serves speculatively, and only idempotent resume or explicit recover can restore serving

#### Scenario: Rotation retry with identical IDs resumes once

- **WHEN** the same request ID, rotation ID, source identity, and target identity are retried after interruption
- **THEN** ledger/state reconciliation returns or completes the one logical rotation without applying a second transformation

#### Scenario: Rotation identifiers cannot be reused for different inputs

- **WHEN** a request ID or rotation ID already belongs to different source/target identities, action, or recovery window
- **THEN** the operation rejects the conflict, emits a sanitized audit outcome, and leaves data/state unchanged

### Requirement: Recovery and finalization are explicit forward lifecycle operations

The system SHALL recover a committed or ambiguous rotation only through an idempotent fixed-version
maintenance operation that re-verifies the retained identities and, when necessary, decrypts and
re-encrypts all rows in one locked transaction. It SHALL NOT depend on Helm rollback. Finalization
SHALL be a separate idempotent action allowed only after verified stable serving and expiry of the
recovery window; it SHALL atomically remove recovery lifecycle state without changing tenant webhook
data.

#### Scenario: Resume completes a proven committed target

- **WHEN** reconciliation proves that the target transaction committed completely and target key/state verify
- **THEN** repeating the original request resumes the fixed target consumer and returns the recorded outcome without another row transformation

#### Scenario: Forward recovery restores the retained source

- **WHEN** target serving cannot be completed within the recovery window and both current and retained recovery identities verify
- **THEN** explicit `recover` quiesces consumers, transactionally re-encrypts every row to the selected retained identity if required, verifies all counts/plaintext, and commits one serving state

#### Scenario: Recovery custody is durable and cannot be relabeled

- **WHEN** `recover` declares managed/external target custody that differs from the custody recorded with the retained recovery identity, or an adopt/rotate/recover replay changes its target-custody flag
- **THEN** the operation fails closed with a bounded lifecycle conflict before changing signing-secret rows or lifecycle state; a successful recovery takes current custody from the durable prior recovery state, retains the durable prior current custody with the new recovery identity, and records those durable values in ledger and audit output

#### Scenario: Recovery failure remains fail-closed

- **WHEN** either required key is missing/incompatible, any row cannot decrypt, or lifecycle reconciliation is ambiguous
- **THEN** recovery rolls back, no consumer resumes, and state remains `recovery_required` with only sanitized diagnostic metadata

#### Scenario: Finalization after the deadline preserves webhook rows

- **WHEN** current serving state is verified, the recovery deadline has elapsed, and finalization uses a new valid request ID
- **THEN** the system removes recovery identity/verification metadata atomically while leaving every `webhook_signing_secrets` row and public webhook behavior unchanged

#### Scenario: Early or repeated finalization is safe

- **WHEN** finalization is attempted too early, against ambiguous state, or repeated after successful completion
- **THEN** an early/ambiguous request is rejected without mutation and an identical completed request is an idempotent no-op

### Requirement: Platform key lifecycle preserves tenant webhook contracts and controls

The system SHALL preserve per-subscription signing-secret plaintext, outbound public webhook
signature bytes/format, tenant/workspace predicates, isolation, authorization, subscription quotas,
row statuses, and all public webhook API contracts across adoption, rotation, recovery, and
finalization. Platform lifecycle operations SHALL NOT be reachable through tenant APIs or normal
tenant database adapters and SHALL NOT introduce a tenant role, gateway route, OpenAPI/SDK operation,
or quota bypass. Initial subscription creation SHALL persist the tenant/workspace subscription and
its active encrypted signing secret in one shared-fence PostgreSQL adapter transaction; the production
action SHALL NOT fall back to separate commits.

#### Scenario: Public signature is unchanged after master-key rotation

- **WHEN** the same subscription secret signs the same webhook payload before and after a successful platform master-key rotation
- **THEN** the public `x-platform-webhook-signature` value and verification behavior are identical because only at-rest wrapping changed

#### Scenario: Tenant and workspace isolation survives every lifecycle action

- **WHEN** adoption, rotation, recovery, or finalization processes rows for multiple tenants/workspaces
- **THEN** each row retains its original tenant/workspace identity and normal reads/writes continue to require the existing tenant/workspace predicates, with no cross-tenant disclosure or mutation

#### Scenario: Tenant subscription quota remains enforced

- **WHEN** a tenant creates subscriptions before or after a platform key lifecycle action
- **THEN** `WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE` and existing `QUOTA_EXCEEDED` behavior are unchanged and the maintenance operation grants no quota exemption

#### Scenario: Initial subscription and signing secret commit together

- **WHEN** POST subscription creation passes validation and the current serving key fence accepts the write
- **THEN** one adapter transaction inserts both tenant/workspace-scoped rows, commits before publishing the existing created event, and returns the unchanged successful response semantics

#### Scenario: Create failure leaves no phantom quota row

- **WHEN** the key fence rejects the resolved identity or the signing-secret INSERT fails after the parent INSERT begins
- **THEN** the transaction rolls back both rows, emits no created event, returns only a bounded `WEBHOOK_KEY_UNAVAILABLE` or create failure without SQLSTATE/trigger/key detail, leaves an adjacent tenant unchanged, and permits a corrected-key retry under quota one

#### Scenario: Tenant-facing secret rotation remains distinct

- **WHEN** an authorized tenant rotates one subscription's signing secret through the existing public route
- **THEN** only that tenant-scoped subscription lifecycle changes, using the verified current platform key, and no platform master-key state or other tenant row is exposed or mutated

#### Scenario: Master-key operation has no public route

- **WHEN** a tenant, machine actor, constrained auditor, or cross-tenant actor probes the published webhook API
- **THEN** no adoption/rotate-master/recover/finalize operation is discoverable or invokable and existing authorization/not-found behavior remains unchanged

### Requirement: Runtime lifecycle status and failures are secret-safe

The system SHALL provide an operator read-only lifecycle status that reports only opaque key
identities, custody/mode, action/request/rotation identifiers, state, bounded counts/timestamps, and
recovery deadline. Runtime and maintenance success/failure paths SHALL NOT expose key bytes, encoded
keys, key digests, decrypted signing secrets, raw Secret objects, raw environment values, SQL
parameters, or unsanitized exceptions through logs, metrics, Events, CLI output, audit records, or
evidence.

#### Scenario: Constrained posture check needs no Secret data

- **WHEN** P4 or P10 runs the documented read-only status/reference checks without permission to read Kubernetes Secret data
- **THEN** they can confirm the configured reference, opaque identity, lifecycle state, counts, deadline, and serving/readiness posture without receiving secret material

#### Scenario: Crypto or database error is sanitized

- **WHEN** parsing, AES-GCM authentication, row migration, database commit, or lifecycle reconciliation throws an internal error
- **THEN** operator-visible output and persisted ledger/audit state use a bounded stable error code/message and do not include raw input, stack, SQL text/parameters, ciphertext plaintext, or key-derived data

#### Scenario: Ordinary create adapter sanitizes PostgreSQL failure detail

- **WHEN** the database writer fence raises SQLSTATE `55000`, a trigger rejects a write, or the signing-secret INSERT raises another raw PostgreSQL error
- **THEN** the adapter/action boundary maps it to a bounded webhook application code/message and does not expose SQLSTATE, trigger text, constraint detail, key identity, ciphertext, IV, tenant/workspace identifiers, or opaque resource IDs

#### Scenario: Observability cannot reveal canonical material

- **WHEN** logs, metrics, Events, pod descriptions, maintenance output, and test/live evidence are searched after successful and failed lifecycle operations
- **THEN** they contain no `v1:` key payload, historical literal, key digest, environment dump, or decrypted per-subscription signing secret
