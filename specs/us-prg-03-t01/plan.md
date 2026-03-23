# Implementation Plan: CI Quality Pipeline and Reproducible Validation

**Branch**: `feature/us-prg-03` | **Date**: 2026-03-23 | **Spec**: `specs/us-prg-03-t01/spec.md`  
**Input**: Feature specification from `/specs/us-prg-03-t01/spec.md`

## Summary

Add a minimal but real CI quality chain that validates repository markdown, the control-plane OpenAPI contract, unit-test helpers, contract expectations, dependency vulnerabilities, and declared image references. Keep the implementation root-driven, auditable, and intentionally narrow so sibling tasks can add runtime-specific quality gates later.

## Technical Context

**Language/Version**: Node.js 20 in CI, Node.js 25-compatible local scripts, Markdown, OpenAPI 3.1 JSON, YAML  
**Primary Dependencies**: `markdownlint-cli2`, `@apidevtools/swagger-parser`, `yaml`, Node built-in `node:test`  
**Storage**: repository-only artifacts and docs; no external services introduced  
**Testing**: root lint/test scripts, GitHub Actions CI jobs, dependency audit, image-policy validation  
**Target Platform**: GitHub Actions on Ubuntu and local Linux development shells  
**Project Type**: monorepo governance/quality increment  
**Performance Goals**: CI should remain fast enough for routine PR feedback and rely on cacheable dependency installation  
**Constraints**: preserve room for T02-T06, avoid introducing runtime frameworks, avoid fake deployment/image build steps, keep all quality gates runnable in current repo state  
**Scale/Scope**: one repository-wide workflow, one OpenAPI artifact, one unit-test suite, one contract-test suite, lightweight security policy for dependencies and image declarations

## Constitution Check

- **Monorepo Separation of Concerns**: PASS — changes stay in root scripts, docs/specs, one OpenAPI artifact, tests, and workflow definitions.
- **Incremental Delivery First**: PASS — the task adds validation plumbing and a minimal contract only.
- **Kubernetes and OpenShift Compatibility**: PASS — Helm values remain portable and image policy avoids mutable tags.
- **Quality Gates at the Root**: PASS — all new checks are invoked from root `pnpm` scripts.
- **Documentation as Part of the Change**: PASS — spec, plan, quickstart, task breakdown, and README updates are included.

## Project Structure

### Documentation and planning

```text
specs/us-prg-03-t01/
├── spec.md
├── plan.md
├── research.md
├── quickstart.md
└── tasks.md

docs/tasks/
└── us-prg-03-t01.md
```

### Repository quality assets

```text
.github/workflows/ci.yml
.markdownlint-cli2.jsonc
apps/control-plane/openapi/control-plane.openapi.json
scripts/
├── lib/quality-gates.mjs
├── validate-openapi.mjs
└── validate-image-policy.mjs

tests/
├── contracts/control-plane.openapi.test.mjs
└── unit/quality-gates.test.mjs
```

**Structure Decision**: Keep T01 centered on root orchestration and auditable artifacts. Do not add application runtime code, container builds, or deployment workflows yet.

## Quality Gates

1. **Markdown lint** — repository-wide markdown validation using `markdownlint-cli2` with a small config tuned for architecture/task docs.
2. **OpenAPI validation** — structural validation of the control-plane OpenAPI 3.1 document using `swagger-parser`.
3. **Unit tests** — built-in `node:test` suite for reusable CI helper logic.
4. **Contract tests** — built-in `node:test` suite that loads the real OpenAPI artifact and enforces versioning/error-contract rules.
5. **Dependency security** — `pnpm audit --audit-level=high` executed from CI and locally.
6. **Image supply-chain policy** — validation of Helm-declared image references to reject mutable tags and missing immutable coordinates.

## Caching and Artifacts

- Use `actions/setup-node` with pnpm caching enabled to reuse the pnpm store between workflow runs.
- Install with `pnpm install --frozen-lockfile` so CI and local validation converge on the same dependency graph.
- Upload the control-plane OpenAPI contract as a workflow artifact so reviewers and downstream tasks can inspect the exact validated contract.

## Supply-Chain Checks

- Fail CI on high-severity dependency vulnerabilities surfaced by `pnpm audit`.
- Enforce fixed image references (semver-like tags or digests) for Helm-declared deployable images.
- Preserve a future extension point for image CVE scanning once sibling tasks introduce buildable or published container images.

## Contracts and API Versioning Expectations

- Business endpoints in the current contract generation must live under the `/v1/` URI prefix.
- Non-health business endpoints must require the `X-API-Version` header to pin the current date-based contract generation.
- OpenAPI `info.version` must remain semver so releases and changelog automation can reason about contract evolution.
- Non-health business endpoints must declare an explicit error contract (`4xx`, `5xx`, or `default`) to keep failure behavior auditable.

## Automated Validation Strategy

1. Add reproducible root scripts in `package.json`.
2. Introduce the minimal control-plane OpenAPI artifact needed for real validation.
3. Implement reusable helper logic for contract and image-policy checks.
4. Add unit tests for helper behavior and contract tests against the real OpenAPI artifact.
5. Replace the bootstrap CI workflow with a two-job quality/security workflow using pnpm cache and artifact upload.
6. Run the full local validation sequence and capture outcomes.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Add dev dependencies to root | Real markdown/OpenAPI validation requires maintained tooling | Hand-written grep-based validators would be brittle and less auditable |
| Add a minimal OpenAPI artifact before runtime exists | Contract validation needs a real source of truth | Stub-only CI would be aspirational rather than runnable |
| Enforce image policy instead of image CVE scanning | No built or published project image exists yet in current repo state | Pretending to scan nonexistent images would be misleading |
