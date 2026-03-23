# Quickstart: Running the CI Quality Chain Locally

## Purpose

Use this task package when you need to validate repository docs, the control-plane API contract, helper logic, or the current supply-chain policy before opening or updating a pull request.

## Read in this order

1. `specs/us-prg-03-t01/spec.md`
2. `specs/us-prg-03-t01/plan.md`
3. `specs/us-prg-03-t01/research.md`
4. `docs/tasks/us-prg-03-t01.md`
5. `apps/control-plane/openapi/control-plane.openapi.json`

## Core commands

Run from repository root:

```bash
corepack pnpm install
corepack pnpm lint
corepack pnpm test
corepack pnpm security:deps
corepack pnpm security:images
```

## What each command covers

- `pnpm lint` — repository structure/ADR validation, markdown lint, OpenAPI validation
- `pnpm test` — unit tests for quality helpers plus contract tests against the real OpenAPI artifact
- `pnpm security:deps` — dependency vulnerability audit at high severity and above
- `pnpm security:images` — immutable image-reference policy checks for Helm-declared deployable images

## Versioning rules to preserve

- Business endpoints stay under `/v1/` for the current contract generation.
- Non-health endpoints require `X-API-Version`.
- `info.version` remains semver.
- Mutable image tags such as `latest` are not allowed.

## Future extension points

- Add runtime-backed API tests when control-plane handlers exist.
- Add container image CVE scanning when the repo builds or publishes actual images.
- Add SBOM generation or signing checks when artifact-producing tasks arrive.
