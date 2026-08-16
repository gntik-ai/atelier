# GAP-001 delivery adapter artifact

This directory is a versioned snapshot of the Falcone delivery-adapter correction for issue #1019.

The installed runtime source remains the Hermes workflow suite. The snapshot is included in Falcone so the PR, review and CI have a durable, auditable artifact even though the local workflow-suite package is not itself a Git repository.

- `hermes-workflows-suite/adapters/falcone/backup-evidence.sh` creates restricted PostgreSQL backup custody, runs an isolated network-none/tmpfs restore rehearsal and emits bounded parity evidence.
- `validate-backup-evidence.sh` binds and expires the evidence against the repo-owned contract.
- `preflight.sh` and `deploy-branch.sh` derive legacy verified inputs only from validated evidence and reject a live-revision mismatch.
- `tests/test-falcone-backup-evidence.sh` is the isolated adapter regression test.
- Coverage is intentionally `postgresql` only. No claim of full-platform DR is made.
