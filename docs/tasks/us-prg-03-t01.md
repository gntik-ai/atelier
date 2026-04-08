# US-PRG-03-T01 Task Breakdown

## Specify summary

Create a practical CI quality pipeline for markdown lint, OpenAPI validation, unit tests, contract tests, and security checks for dependencies/image declarations. Keep the increment small, real, and runnable in the current repo state.

## Executable plan

1. Add reproducible root scripts and a lockfile-backed dependency set for quality tooling.
2. Introduce a minimal but valid control-plane OpenAPI contract so the pipeline validates a real artifact.
3. Add helper logic, unit tests, and contract tests for versioning and supply-chain expectations.
4. Replace the bootstrap workflow with quality and security jobs that use pnpm cache and upload the contract artifact.
5. Run local validation commands and capture outcomes.

## Concrete implementation tasks

- [x] Add root quality/security scripts and dev dependencies in `package.json`.
- [x] Add `.markdownlint-cli2.jsonc`.
- [x] Add `apps/control-plane/openapi/control-plane.openapi.json`.
- [x] Add `scripts/lib/quality-gates.mjs`, `scripts/validate-openapi.mjs`, and `scripts/validate-image-policy.mjs`.
- [x] Add `tests/unit/quality-gates.test.mjs` and `tests/contracts/control-plane.openapi.test.mjs`.
- [x] Replace `.github/workflows/ci.yml` with a multi-job CI workflow.
- [x] Replace mutable Helm image tags in `charts/in-falcone/values.yaml`.
- [x] Run repository validation commands.
