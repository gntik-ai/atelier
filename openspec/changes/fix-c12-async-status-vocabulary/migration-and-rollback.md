# Migration and rollback note

## No database migration

C-12 makes no schema change and adds no migration. The database is already correct: migration
`packages/provisioning-orchestrator/src/migrations/076-timeout-cancel-recovery.sql` expanded the
`async_operations_status_check` constraint to the seven values
(`pending`, `running`, `completed`, `failed`, `timed_out`, `cancelling`, `cancelled`) and defined the
active partial index `idx_async_ops_status_updated ... WHERE status IN ('running', 'pending',
'cancelling')` when it shipped. C-12 reconciles the reader layers (internal contracts and the
Operations console) with that already-deployed persistence; it does not alter, add, backfill, or
re-order any migration, column, index, constraint, trigger, or default.

Migration 076 is treated as immutable. It is not regenerated, edited, or reformatted by this change.
It remains the database mirror of the status vocabulary and is instead verified by a deterministic
parity check.

## Forward "migration" is generation plus parity, not DDL

The forward change is a build-input reconciliation, not a data migration:

1. one authoritative catalog
   (`packages/internal-contracts/src/async-operation-status-vocabulary.json`) is added;
2. a deterministic generator
   (`scripts/generate-async-operation-status-vocabulary.mjs`) produces the committed backend,
   internal-contract, and console artifacts from the catalog; and
3. a no-write check (`pnpm validate:async-operation-status-vocabulary`) re-renders those artifacts,
   parses migration 076 for the status constraint and the active partial index, and fails non-zero —
   naming exact stale paths — if any generated artifact or the migration mirror disagrees with the
   catalog.

Generated files are committed build inputs. Production startup and request handling never run the
generator or mutate source; the generator and its check run only at development time and in the CI
lint job through `validate:repo`.

### Pre-merge checks

Before the change merges, the schema-independent gate SHALL verify:

1. running the generator twice against an unchanged catalog produces byte-identical output;
2. the no-write check passes with no stale path when the tree is consistent, and fails with the exact
   path when any generated artifact is deliberately made stale;
3. migration 076's status constraint lists exactly the seven catalog values in order, and its active
   partial index lists exactly `running`, `pending`, and `cancelling`, with the migration file left
   byte-for-byte unchanged; and
4. the two internal schema enum locations equal the authoritative ordered list and carry the
   generated-status annotation.

There is no schema-readiness or boot-migration step to add, because no DDL is introduced. The
existing control-plane boot path and its migration set are unaffected.

## Normal rollback

Rollback is a coordinated revert of the catalog, the generator and its check wiring, every generated
backend/contract/console artifact, the hand-written consumers that import them, the focused tests,
and the documentation, together with this OpenSpec package. Because there is no migration, there is
no schema or data rollback and no data restoration step.

The safe posture is that the catalog source and every generated output are one revision that rolls
forward and back together:

- reverting reintroduces the four-value contract enums and the six-value console vocabulary that
  omit `cancelling`, which is exactly the C-12 pre-fix state, with no data effect;
- the database keeps the seven-value constraint from migration 076 either way, so rollback does not
  reintroduce a schema mismatch; and
- older application revisions ignore statuses they do not special-case, so a reverted reader simply
  returns to rejecting or blank-rendering `timed_out`/`cancelling`/`cancelled` without corrupting
  data.

A partial rollback that leaves the catalog and its generated outputs, or different generated outputs,
at different revisions is rejected by the same no-write drift check: the tree cannot pass validation
until the catalog and every generated artifact are back to one consistent revision. This makes a
mixed-revision state non-mergeable rather than silently shipped.

## No destructive database action

Because C-12 introduces no migration, there is no additive DDL to keep and no destructive DDL to
guard. The historical migration set — including migration 076 and its already-present status
constraint and active index — is unchanged. Any future change to the persisted status vocabulary
would be a separate, explicitly approved migration that also updates the authoritative catalog so the
generator, the contracts, the console, and the parity check move together; that work is out of scope
here.

## Verification and recovery

Forward verification does not require a live cluster. It uses:

- the deterministic generator idempotence and no-write check;
- the static migration-076 parity assertions;
- AJV validation of the query-response and state-change contracts for every status and every allowed
  transition edge, with unknown values rejected; and
- the isolated real-PostgreSQL async-operation suite, run against a disposable local or CI database
  URL, applying the real migration chain and persisting/transitioning every canonical status through
  legitimate graph paths, with no shared or production database contacted.

If the no-write check reports a stale artifact, regenerate with
`pnpm generate:async-operation-status-vocabulary` and re-run the check; do not hand-edit a generated
file, because that reintroduces the drift the catalog exists to prevent. If the migration-076 parity
assertion fails, reconcile the catalog to the shipped constraint rather than editing the deployed
migration.
