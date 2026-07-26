## Context

Audit C-25 / DEVOPS-08 was confirmed at E6 against Falcone SHA
`23854f3361ea6ac6837654021fb786044819e62a`: the deployed control-plane workload and its
environment override carry `WEBHOOK_SIGNING_KEY` as a literal `env.value`. The audited canonical
chart is `falcone-charts` SHA `9aab27e7695e20156b7a4f61b5f2f789f59ee59a` (chart `0.3.0`).

The current webhook engine converts any non-32-byte string to `SHA-256(string)` and uses the result
as an AES-256-GCM master key for `webhook_signing_secrets.secret_cipher`/`secret_iv`. Both management
and delivery paths silently use `development-signing-key` when the environment variable is absent.
The startup path begins listening before its asynchronous schema bootstrap has completed. Therefore
changing only the Helm environment entry would neither migrate existing ciphertext nor ensure that a
server has verified the correct key before accepting traffic.

The umbrella chart aliases the generic `component-wrapper` subchart as `controlPlane`. Helm globals
are the stable way to make a dedicated umbrella-level key lifecycle contract visible inside that
aliased subchart without adding a generic secret controller to every component. The chart owns
deployment mechanics; Falcone owns the key parser, database lifecycle, maintenance CLI, migration,
and OpenSpec.

P18 performs install/upgrade/recovery, P4 verifies posture without Secret-data access, and P3
coordinates the maintenance window. P10 must be able to inspect non-secret evidence without gaining
mutation rights. P12 webhook consumers and P13 cross-tenant actors must observe no public contract,
authorization, or isolation regression. P17 needs an executable runbook that does not depend on
source archaeology.

## Goals / Non-Goals

**Goals:**

- Remove all inline and fallback master-key paths and require a strict Secret reference in every
  environment.
- Generate fresh-install managed key material inside the cluster, preserve the exact bytes on normal
  upgrades, and support externally managed Secrets without mutating them.
- Adopt existing legacy-normalized ciphertext explicitly, then rotate it to canonical-v1 material in
  a separate, idempotent maintenance operation with bounded recovery.
- Gate server listen/readiness on schema, key, identity, and lifecycle verification.
- Preserve exact per-subscription plaintext, public webhook signatures, row identities/scopes/status,
  tenant/workspace isolation, quotas, authorization, and public API behavior.
- Keep key bytes out of Helm state and every observable non-Secret surface while giving P4 useful
  reference/lifecycle evidence.
- Define a release sequence that spans Falcone application/image, `falcone-charts`, and the Falcone CI
  chart pin without creating an undecryptable intermediate state.

**Non-Goals:**

- No UI, OpenAPI, SDK, gateway, public-auth, Kafka, or public audit-schema change.
- No new tenant role, tenant-callable master-key endpoint, or change to the existing per-subscription
  secret-rotation route.
- No KMS, ESO, Vault/OpenBao, or general-purpose Kubernetes secret-controller integration.
- No claim that Kubernetes Secret RBAC, etcd encryption/backups, node access, or authorized pod
  `exec` custody is solved; operators retain those responsibilities.
- No support for same-name/in-place external key rotation or Helm rollback to an unsafe historical
  revision.

## Decisions

### D1 — Use one umbrella global chart contract and prohibit every inline escape hatch

The public chart contract is `global.webhookSigningKey` with these fields:

- `create`
- `secretName`
- `secretKey`
- `adoption.mode` (`none` or `legacy`) and `adoption.requestId`
- `rotation.action` (`none`, `rotate`, `recover`, or `finalize`),
  `rotation.requestId`, `rotation.sourceSecretName`, `rotation.sourceSecretKey`,
  `rotation.rotationId`, and `rotation.recoveryWindowSeconds`

There is deliberately no inline/value field. Umbrella template validation rejects the reserved
`WEBHOOK_SIGNING_KEY` name in every chart-inspectable route that can reach the control-plane
environment: `controlPlane.env` (regardless of `value` or `valueFrom`),
`global.transportSecurity.env` (regardless of the transport feature or component opt-in state), and
the generated env ConfigMap at `controlPlane.config.inline`. External `envFromSecrets` and
`envFromConfigMaps` references remain supported because Helm cannot inspect their keys and the
dedicated explicit entry below has precedence. The aliased component wrapper recognizes only the
control-plane component identity and appends exactly one environment entry:

```yaml
- name: WEBHOOK_SIGNING_KEY
  valueFrom:
    secretKeyRef:
      name: <global.webhookSigningKey.secretName>
      key: <global.webhookSigningKey.secretKey>
      optional: false
```

It also appends only non-secret `WEBHOOK_SIGNING_KEY_MODE` and
`WEBHOOK_SIGNING_KEY_ID` values and non-secret rollout annotations. `WEBHOOK_SIGNING_KEY_ID` is a
versioned opaque encoding derived exclusively from namespace, Secret name, and key name; it is never
derived from key bytes or a key digest.

*Alternative considered:* accept a `value` field or allow users to add their own environment entry.
Rejected because either route returns key material to rendered YAML/Helm history and can create
ambiguous duplicate environment entries.

### D2 — Generate and validate credentials in an in-cluster hook without rendering bytes

Ordered pre-install/pre-upgrade credential and lifecycle Jobs run commands from a compatible Falcone
image. The earlier credential Job creates a missing eligible managed target directly through the
Kubernetes API, then exits; the later validation/lifecycle Job starts only after the Secret exists and
receives source/target keys and database credentials through `secretKeyRef`. This avoids making a Pod
depend on a Secret that its own process is expected to create. The Jobs use dedicated ServiceAccounts
and namespace-scoped, least-privilege RBAC. For managed Secrets the credential/finalization phases can
get/create and, only during explicit finalization, delete a specifically identified chart-owned
Secret. They cannot update or patch Secret data. No phase passes key material through arguments.

On a fresh install with `create=true`, the Job uses a cryptographically secure random source to create
exactly 32 random bytes and stores `v1:` followed by the 43-character unpadded base64url encoding of
those bytes. Generation happens inside the Job and Kubernetes API; neither the key nor an encoded
form is part of Helm templates, values, release state, command arguments, output, or Events. The
created Secret is immutable, labeled with non-secret ownership/identity metadata, and retained across
upgrade and uninstall.

On an ordinary upgrade, an existing owned Secret is strictly validated and reused byte-for-byte. A
missing owned Secret fails the upgrade; it is not silently regenerated. Creation of a new managed
target on upgrade is allowed only for an explicit `rotate` operation with a new Secret identity.

With `create=false`, the Job performs read-only existence/key/format validation and never labels,
updates, patches, deletes, or otherwise claims the external Secret. External managers must create a
new Secret name for rotation. If an external manager changes data at the current name, the stable key
identity no longer verifies the database sentinel and every runtime fails closed.

*Alternative considered:* Helm `randBytes`, a rendered Secret, `lookup`-based reuse, or a precomputed
value. Rejected because rendered material can enter manifests, release history, debug output, and
GitOps evidence, and because render-time behavior is not an auditable transactional lifecycle.

### D3 — Parse canonical-v1 strictly and confine legacy normalization to declared state

The application parser accepts canonical material only when it matches
`^v1:[A-Za-z0-9_-]{43}$`, decodes as unpadded base64url to exactly 32 bytes, and round-trips to the
same canonical text. Padding, alternate alphabets, whitespace, wrong decoded length, trailing data,
unknown versions, and malformed Unicode are rejected. The application never hashes malformed
canonical material into a usable key.

The old `32-byte-or-SHA-256(string)` normalization remains available only inside an explicit
`adoption.mode=legacy` or recovery operation whose request and lifecycle state authorize it. It is
not a general runtime fallback. `development-signing-key` is removed in all environments, including
development and tests; tests must inject valid material deliberately.

*Alternative considered:* continue accepting arbitrary strings for compatibility. Rejected because
it makes typoed and truncated input silently select a different valid AES key.

### D4 — Add migration 004 as additive lifecycle metadata, isolated from tenant data access

`packages/webhook-engine/migrations/004-webhook-master-key-lifecycle.sql` is additive and idempotent:

- add nullable `encryption_key_id` to `webhook_signing_secrets` so existing rows remain deployable
  until explicit adoption;
- create singleton `webhook_master_key_state` for non-secret current/recovery key identities, modes,
  lifecycle state, recovery deadline, and key-verification ciphertext/IV;
- create `webhook_master_key_rotations` as the idempotency and audit ledger, containing action,
  request/rotation IDs, source/target identities, state, affected/verified counts, timestamps,
  recovery deadline, and a bounded sanitized error code/message.

The state and ledger contain no key bytes, encoded keys, key digests, decrypted subscription secret,
tenant payload, or raw exception/SQL text. The key-verification value is a fixed application sentinel
encrypted with a fresh IV; successful authenticated decryption proves that the referenced key matches
state without persisting a key digest. Unique constraints make request IDs and rotation IDs
idempotent; reuse with different identities/action is a conflict.

Lifecycle tables are platform-global and accessible only through a dedicated maintenance repository.
Normal webhook database methods retain their tenant/workspace predicates and cannot invoke platform
lifecycle operations. New and re-encrypted signing-secret rows carry the applicable
`encryption_key_id` without changing their tenant/workspace columns or RLS/application predicates.
Because the distinct lifecycle `LOGIN` has `INHERIT FALSE`, every lifecycle-repository read as well
as every mutation begins a transaction and executes
`SET LOCAL ROLE falcone_webhook_key_lifecycle` before touching either lifecycle table. Read-only
resolution, status, and already-quiesced replay authorization use one repeatable-read, read-only
transaction and release the leased connection after commit or rollback. Their leaf state/ledger
helpers accept an already-leased transaction client, so a mutation reuses its existing exclusive
transaction instead of nesting a transaction or querying through the pool. The transaction-local
role therefore resets before later pooled work; direct lifecycle-LOGIN table reads remain denied.

The existing global `DB_URL`/`PG*` pool remains the source boundary for tenant/workspace, saga,
governance, saga recovery, and workspace-database creation. It is not rebound to a fixed webhook
authority and does not enter webhook adapters. Four additional DSNs authenticate the webhook schema,
ordinary runtime, encrypted-writer, and lifecycle `LOGIN`s. Schema and startup-lifecycle pools close
after their bounded work; global, webhook-runtime, and webhook-writer pools remain serving.

Before application DDL, an ordered chart one-shot bootstrap authenticates with the bundled
PostgreSQL administrator Secret. PostgreSQL 16 is the minimum version. That bootstrap creates or
validates the credentialed schema, runtime, writer, and lifecycle `LOGIN`s; creates or validates
`falcone_app`, `falcone_webhook_key_lifecycle`, and `falcone_webhook_key_writer` as fixed `NOLOGIN`,
non-superuser, non-`BYPASSRLS` authorities; declares one durable administrator grantor distinct from
every application/fixed principal; repairs legacy memberships using that grantor; and establishes
exactly these edges:

- `falcone_app` → runtime: `ADMIN FALSE, INHERIT TRUE, SET FALSE`;
- `falcone_webhook_key_writer` → writer:
  `ADMIN FALSE, INHERIT FALSE, SET TRUE`;
- `falcone_webhook_key_lifecycle` → lifecycle:
  `ADMIN FALSE, INHERIT FALSE, SET TRUE`.

It persists generated credentials for idempotent reuse. Its administrative credential is mounted
only in that Job and is never injected into the control-plane Deployment or lifecycle Job. On
upgrade from a legacy single-`falcone` owner, the bootstrap transfers only the four pre-C-25 webhook
tables to the new schema LOGIN; if a prior partial attempt created C-25 objects, it also transfers
only the two lifecycle tables and three enumerated webhook functions. The handoff validates that
every current owner is either the proven legacy owner or the declared schema LOGIN and fails
otherwise. It never uses a database-wide ownership reassignment.

Migration `004` validates that all three fixed roles already exist with bounded attributes, verifies
the exact PostgreSQL 16 edge options and declared grantor, and fails closed when the required graph
is absent or invalid. It never creates/alters global roles, grants or revokes membership, binds
logins, repairs implicit memberships, or claims it can revoke a role membership made by another
grantor. As the bounded owner of only the enumerated webhook objects, it deterministically removes
all PUBLIC, fixed-authority, unexpected-grantee, column-level, and function-execution excess,
including alternate-grantor/downstream chains, with `CASCADE` at each exact enumerated
object/grantee boundary before applying the exact allowlist. Non-enumerated objects and role
memberships are outside that cascade boundary:
`falcone_webhook_key_lifecycle` receives relation-scoped lifecycle grants and a
signing-secret-only RLS policy; `falcone_webhook_key_writer` receives only grants/policies required
for atomic encrypted writes; and `falcone_app` receives tenant-scoped webhook reads and non-secret
operations in both migration-003/FORCE-RLS-present and RLS-absent paths. Runtime has no lifecycle
table access and no INSERT/UPDATE privilege on encrypted signing-secret columns.

For the migration-003 variant, replay drops and recreates the exact seven role-bound permissive
policies with exact predicates and requires FORCE RLS on all four tenant relations. For the
migration-003-absent variant, all four tenant relations remain without RLS and no policy survives.
Lifecycle tables never enable RLS. Post-DDL verification checks exact ownership, relation and
function ACLs and grantors, absence of column grants, RLS flags, and the complete policy inventory
and definitions; drift cannot pass merely because ownership remains correct.

Before DDL and again before listen, every real connection is leased and queried for both
`session_user` and `current_user` before any transaction-local `SET ROLE`. The values must match and
the global plus four webhook session users must be pairwise distinct. Each webhook login is
non-superuser, non-`BYPASSRLS`, non-`CREATEROLE`, non-`CREATEDB`, and non-replication; the global
login may retain only its existing `CREATEDB` capability among those attributes. All webhook
sessions must equal their declared LOGIN names. The exact direct role graph, administrator grantor,
enumerated webhook table/function ownership, object authorization, and RLS state must match the
contract. The schema login owns/migrates only those objects but is not a runtime principal or
writer/lifecycle member and is closed after migration/verification. An admin/superuser DSN hidden
behind startup-role aliases therefore fails before lifecycle transactions or listen.

*Alternative considered:* record a SHA-256 key fingerprint. Rejected because the architected
verification ciphertext gives authenticated proof without spreading key-derived metadata.

### D5 — Gate every server and consumer on a single resolved key context

Control-plane bootstrap is restructured so it awaits schema migration, resolves the referenced key,
strictly parses it according to `WEBHOOK_SIGNING_KEY_MODE`, and verifies
`WEBHOOK_SIGNING_KEY_ID` plus lifecycle state before `server.listen`. Readiness remains false until
all checks succeed. Missing configuration, wrong format, verification-cipher failure, unlabeled
legacy rows, a key-ID mismatch, expired/unfinalized ambiguity, `rotation_in_progress`, or
`recovery_required` terminates startup or keeps the consumer unready; none can fall back.

On an empty database with no signing-secret rows, a canonical key may atomically initialize the
singleton state and verification ciphertext. A database with rows but no lifecycle state must be
adopted explicitly and cannot auto-initialize. Management, delivery, retry, and any later webhook
consumer receive the already-resolved `{keyBytes, keyId, mode}` context rather than independently
reading or normalizing raw environment strings.

Every ordinary adapter transaction that inserts encrypted signing-secret material, or rotates a
per-subscription secret, takes the lifecycle advisory lock in shared transaction mode before any
row write and asserts that durable state is `serving` with the same opaque key identity as its
resolved context. Migration `004` also installs a database trigger over every encrypted
signing-secret `INSERT` and relevant `UPDATE`: a statement trigger takes the same shared transaction
lock before row discovery, and a security-invoker row trigger requires the effective
`falcone_webhook_key_writer` role and compares the row label with the durable current identity
obtained through a bounded security-definer function. It does not consult a caller-controlled GUC;
the application-selected label and ciphertext therefore cannot confer write authority. A
pre-C-25/direct runtime writer cannot bypass the fence or preserve a new label while writing old-key
ciphertext. Before the first durable state exists only the bounded owner/superuser maintenance path
may seed unlabeled fixtures; migration completion waits for pre-existing row writers, and adoption's
later exclusive lock includes those writes in its all-row snapshot.

Lifecycle-owned row transformations are admitted only when the transaction both holds the matching
exclusive advisory lock and executes as the effective dedicated lifecycle role, effective table
owner, or effective superuser. The trigger is security-invoker and evaluates `current_user`; it does
not infer authority from `session_user`, role membership, a caller-controlled setting, or the fixed
lock shape. Therefore even a superuser connection after `SET LOCAL ROLE falcone_app` is constrained
as `falcone_app`, and acquiring `pg_advisory_xact_lock(723661,25)` cannot authorize a foreign-key
INSERT/UPDATE. The lifecycle repository explicitly assumes the fixed role transaction-locally before
taking the exclusive lock, so adoption, canonical rotation, and recovery take their transformation
snapshot under the independently authorized effective identity. Consequently, an already-fenced
ordinary writer commits before lifecycle can inspect all rows, while a stale source-context writer
waiting behind a committed lifecycle operation fails with a bounded unavailable code before writing.

The deployed PostgreSQL adapter also exposes one required
`insertSubscriptionWithSecret(record, encrypted, keyId)` operation. It begins the shared-fence
transaction before either insert, verifies the durable key identity, inserts the tenant/workspace
subscription and its active encrypted signing-secret row, and commits both together. The production
action has no fallback to the former split `insertSubscription` then `insertSecret` sequence. A fence,
constraint, or secret insert failure rolls back the parent row, is mapped to a bounded application
error, emits no created event, consumes no quota slot, and permits a corrected-key retry.

`buildWebhookDb` also has no pool fallback: construction requires an explicit ordinary runtime pool
and a distinct explicit writer pool. The handler rejects a missing pool, a shared runtime/writer
object, or either webhook pool aliasing the global control-plane pool before it dispatches a
persistence operation; the startup five-session verifier remains authoritative for authenticated
database identities. A stale per-subscription rotation that reaches the shared fence returns the
same bounded HTTP 503 `WEBHOOK_KEY_UNAVAILABLE` response as another expected encrypted write,
changes no signing-secret row, and emits no rotation event. Unexpected database failures are
collapsed to a storage-agnostic rotation error without SQLSTATE, constraint, key identity,
ciphertext, IV, DSN, or exception-message detail.

*Alternative considered:* validate lazily on the first webhook operation. Rejected because a pod
could report ready and serve unrelated or partially working traffic with ambiguous encrypted state.

### D6 — Make adoption explicit, idempotent, and non-rotating

Legacy adoption requires `adoption.mode=legacy`, a new `adoption.requestId`, a maintenance window,
the fixed application/image and chart, and a Secret containing the exact former literal supplied
through a secret-safe external provisioning channel. The operation quiesces all chart-owned webhook
crypto consumers, acquires an exclusive PostgreSQL advisory/transaction lock, verifies that every
existing row decrypts with the exact historical legacy SHA-256 normalization, assigns the opaque
`encryption_key_id`, creates the singleton verification state in legacy mode, and commits atomically.
It does not change per-subscription plaintext or implicitly rotate to canonical-v1.

The same request with the same inputs returns the recorded outcome without repeating work. Any
undecryptable row, mixed/unknown state, non-empty database initialized under a different identity, or
request-ID conflict aborts the transaction and leaves the previous serving state unchanged. Operators
perform canonical rotation separately after the adopted release is stable.

*Alternative considered:* automatically infer and adopt an arbitrary old string. Rejected because
an incorrect candidate can make a destructive migration look successful for only a subset of rows.

### D7 — Rotate all rows in one locked transaction and use a new key identity every time

For `rotation.action=rotate`, the top-level Secret reference is the new target identity and
`rotation.sourceSecretName`/`sourceSecretKey` identify the current source. Source and target
namespace/name/key identities must differ. Same-name or in-place rotation is rejected even when the
bytes differ. A `rotation.requestId` and `rotation.rotationId` are mandatory, immutable idempotency
keys, and `recoveryWindowSeconds` defines the bounded recovery retention deadline.

The maintenance command:

1. quiesces and verifies the drain of all chart-owned consumers that can encrypt or decrypt webhook
   secrets;
2. resolves and verifies source and target keys without printing them;
3. takes the platform advisory lock exclusively (after all ordinary shared-lock writer
   transactions have committed) and a database transaction lock;
4. decrypts every `webhook_signing_secrets` row with its recorded source identity;
5. re-encrypts the exact plaintext with the canonical target using fresh AES-GCM IVs, verifies the
   result, and updates only ciphertext, IV, and `encryption_key_id`;
6. preserves row IDs, subscription IDs, tenant/workspace IDs, status, grace/revocation timestamps,
   and all public subscription/delivery state;
7. atomically commits the new current state, source recovery identity, verification ciphertext, row
   counts, and recovery deadline;
8. rolls the fixed `secretKeyRef` consumer to the target identity and resumes serving only after
   startup verification succeeds.

Tenant-facing subscription quotas, tenant authorization, and per-subscription rotate-secret
semantics do not apply to or change this platform maintenance operation. It is available only as an
operator CLI/hook, not through an HTTP route.

*Alternative considered:* dual-decrypt in normal serving or row-by-row commits. Rejected because
they extend exposure/ambiguity and allow a partially migrated database to serve.

### D8 — Define deterministic failure, retry, recovery, and finalization states

If any step before transaction commit fails, PostgreSQL rolls back every row and state change; the
hook restores the old quiesced consumer using the source reference, records only a sanitized failure,
and leaves the target Secret retained for diagnosis/retry. No partial row set is served.

If commit outcome or the post-commit rollout is ambiguous, lifecycle becomes `recovery_required` and
all consumers remain stopped or fail startup. Repeating the same request first reconciles the ledger,
row identities/counts, verification ciphertexts, and database state. It either resumes the committed
target idempotently or requires explicit `rotation.action=recover`.

`recover` is a forward fixed-chart operation, never a historical Helm rollback. It uses a new request
ID, the retained source and current identities, the same quiesce/lock/single-transaction algorithm,
and idempotently restores a verified serving state without changing tenant data semantics.

`finalize` is allowed only after a verified stable state and the recovery deadline. It removes the
recovery identity and verification metadata atomically. It may delete only an immutable Secret that
has the expected chart ownership labels and is no longer current; it never deletes an external
Secret. Repeated finalization is a no-op. Before finalization, managed current and recovery Secrets
survive upgrades and uninstall.

*Alternative considered:* rely on `helm rollback`. Rejected because Helm history may contain the
literal `env.value`, and application rollback across a committed data-key transition can make every
row undecryptable or re-expose the key.

### D9 — Treat backup and key custody as one recovery unit

The runbook requires a tested database backup before adoption/rotation and verifies custody of every
referenced current/recovery Secret for the entire recovery window. Restoring a backup requires the key
identity that protected its rows and reconciliation through the fixed chart's `recover` flow. The
runbook never suggests embedding key material in backup metadata or evidence.

Kubernetes Secret access policy, etcd encryption and backups, node/root access, authorized `exec`,
and external-manager availability remain operator responsibilities. These boundaries are stated
explicitly so the reference fix is not mistaken for end-to-end infrastructure key custody.

### D10 — Provide secret-safe operational evidence without a public API

The maintenance CLI has a read-only status mode that reports only action/request/rotation IDs, opaque
Secret identities, managed/external custody mode, lifecycle state, counts, timestamps, and recovery
deadline. Workload inspection shows one `secretKeyRef`, `optional: false`, and non-secret rollout
annotations. Its lifecycle-table reads run through the same transaction-local fixed authority as
resolution and quiesced-replay authorization; the bounded lifecycle LOGIN has no direct table grant
and returns to its authenticated identity when the transaction ends. P4/P10 do not need permission
to read Secret data for these checks.

Logs, metrics, Kubernetes Events, CLI output/errors, test artifacts, screenshots, and audit evidence
must use stable sanitized codes and non-secret identities. Neither success nor failure paths print
raw environment objects, Secret API objects, SQL parameters, ciphertext plaintext, key bytes, encoded
keys, or key digests. Existing internal audit integration records the sanitized maintenance outcome;
no public audit schema is added.

### D11 — Release and pin in dependency order

The coordinated sequence is:

1. merge and publish a compatible Falcone application/image containing migration 004, strict parsing,
   startup gating, maintenance CLI, and legacy adoption support;
2. merge and publish the `falcone-charts` contract, hooks/RBAC, fixed image reference, tests, and
   release notes;
3. update Falcone CI `FALCONE_CHARTS_REF` to the released chart commit and rerun cross-repository
   render/contract tests;
4. for each environment, prepare backup and recovery custody, provision the exact legacy value into
   a Kubernetes Secret without Helm/CLI leakage, and perform explicit legacy adoption during a
   maintenance window;
5. after stable service, perform a separate canonical-v1 rotation to a new Secret identity;
6. after the recovery window and restore test, explicitly finalize the retained recovery identity.

The image and chart are not independently deployable across the key transition. Release notes and CI
pinning declare compatible minimum versions.

## Risks / Trade-offs

- [A single transaction over all signing-secret rows can be long and WAL-heavy] → Require a sized
  maintenance window, preflight row count/free-space checks, bounded statement/lock timeouts, a tested
  backup, and no partial serving.
- [A crash can occur after PostgreSQL commits but before the Job observes success] → Persist
  idempotency/state in the same transaction, fail closed as `recovery_required`, and reconcile with
  the same request before resume/recover.
- [A pre-upgrade hook that quiesces consumers can leave service unavailable] → Record expected
  replicas/state, restore source serving on pre-commit failure, make retries idempotent, and document
  the maintenance-window availability impact.
- [An external manager can mutate a Secret at the same name] → Reject same-identity rotation and
  verify the database sentinel on every startup/upgrade; a mutation produces fail-closed behavior,
  not silent re-encryption.
- [Helm history retains the old literal even after current values are safe] → Document history cleanup
  according to operator policy, restrict release-Secret access, retain recovery material, and ban
  rollback to any revision that renders `env.value`.
- [A database backup without its matching key is unusable] → Couple backup inventory and recovery-key
  custody by opaque identity and test restore/recover before finalization.
- [Secret-safe evidence can accidentally capture data through broad commands] → Provide exact
  field-selecting commands and tests that fail on literals, canonical key patterns, raw Secret
  objects, env dumps, and unsafe CLI arguments.
- [Managed Secret deletion during finalization is destructive] → Require elapsed deadline, confirmed
  non-current identity, exact ownership labels, an explicit action/request ID, and a no-op/reject path
  for external or ambiguous Secrets.

## Migration Plan

1. Establish green baselines in both repositories and record the pinned SHAs.
2. Implement and publish the Falcone-compatible image; do not deploy it alone into a legacy chart
   revision that lacks the mode/identity lifecycle contract.
3. Implement, test, and release the chart using that image; update the Falcone chart pin.
4. In a maintenance window, stop/drain consumers, take and test a backup, provision the exact legacy
   key into a Kubernetes Secret through a secret-safe channel, and run `adoption.mode=legacy` with a
   unique request ID.
5. Verify the fixed workload has one required Secret reference, the legacy lifecycle is `serving`,
   every row has the expected opaque key identity, and public/tenant behavior remains unchanged.
6. In a later maintenance window, rotate to a new canonical-v1 Secret identity with a unique request
   and rotation ID. Retain the old key as recovery material.
7. If failure occurs before commit, resume source serving. If outcome is ambiguous or failure follows
   commit, use the fixed chart to resume or run explicit `recover`; do not use Helm rollback.
8. After the recovery window, successful tenant/public regression checks, and a restore/recovery test,
   run `finalize`. Delete only eligible chart-managed recovery Secrets.

## Open Questions

No architectural questions remain for this bounded change. Implementation may tune maintenance
timeouts and the default recovery-window value, but it must not weaken the normative lifecycle,
transactionality, fail-closed, or no-leak requirements.
