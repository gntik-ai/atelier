# In Atelier Constitution

## Core Principles

### I. Monorepo Separation of Concerns
Applications live under `apps/`, reusable service-side logic and operational assets live under `services/`, deployment packaging lives under `charts/`, and executable end-to-end validation lives under `tests/`. New top-level folders require an explicit rationale in `docs/`.

### II. Incremental Delivery First
Bootstrap work must stay minimal, reviewable, and forward-compatible. Prefer adding stable structure, scripts, and documentation before introducing framework or infrastructure complexity.

### III. Kubernetes and OpenShift Compatibility
Deployment artifacts must use portable Kubernetes APIs and avoid assumptions that break OpenShift defaults. Security context, routes, service exposure, and secret handling must be introduced explicitly rather than implicitly.

### IV. Quality Gates at the Root
Every feature must contribute to root-level quality gates that can run from the repository root. During bootstrap, these gates may be structural; later tasks must evolve them into behavioral lint, test, and typecheck checks.

### V. Documentation as Part of the Change
Every structural decision that affects repository layout, deployment shape, or developer workflow must be documented in `docs/` or `docs/adr/` within the same change.

## Additional Constraints

- Package management standard: `pnpm` workspaces.
- CI entry point starts from root scripts.
- Secrets must not be committed to the repository.
- Runtime stack choices for individual apps/services should remain open until follow-up tasks justify them.

## Development Workflow

- Keep tasks narrowly scoped and reversible.
- Prefer placeholders with clear intent over speculative implementation.
- Add or update validation commands whenever repository expectations change.
- Preserve room for sibling tasks before adding framework-specific tooling.

## Governance
This constitution governs early project bootstrap and supersedes undocumented conventions. Amendments must update this file and any affected repository guidance in the same change.

**Version**: 0.1.0 | **Ratified**: 2026-03-22 | **Last Amended**: 2026-03-22
