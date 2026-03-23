# Research: Minimal CI Quality Chain for the Current Monorepo State

## Decision Drivers

1. **Runnability now** — every quality gate should execute in the current repository state without waiting for future runtime code.
2. **Auditability** — the repo should contain concrete artifacts, not only workflow placeholders.
3. **Incremental scope** — T01 must not consume work reserved for sibling tasks T02-T06.
4. **Reproducibility** — local and CI execution should share the same root commands and lockfile.
5. **Security signal quality** — the baseline should surface meaningful supply-chain issues without inventing nonexistent runtime images.

## Tooling Choices

### Markdown lint

**Chosen**: `markdownlint-cli2`

**Why**
- Actively maintained and simple to wire at the repository root.
- Works well for a doc-heavy bootstrap repository.
- Supports a lightweight config file without introducing a larger docs toolchain.

### OpenAPI validation

**Chosen**: `@apidevtools/swagger-parser`

**Why**
- Validates a real OpenAPI 3.1 contract artifact.
- Minimal integration surface for Node-based CI scripts.
- Good fit for a repo that needs structural validation before runtime implementation exists.

### Unit and contract tests

**Chosen**: Node built-in `node:test`

**Why**
- No extra test runner required.
- Sufficient for helper-level tests and contract assertions against the OpenAPI artifact.
- Keeps the CI chain small and easy to reason about.

### Dependency security

**Chosen**: `pnpm audit --audit-level=high`

**Why**
- Real vulnerability signal tied to the lockfile.
- Easy to run locally and in CI.
- Appropriate for a repository with a small, explicit dependency footprint.

### Image security

**Chosen**: immutable image-reference policy validation on Helm values

**Why**
- Current repo state declares deployable images but does not yet build or publish them.
- A policy gate against `latest` and missing immutable coordinates is honest, actionable, and runnable now.
- It preserves a clean extension point for future image CVE scanning once real images exist.

## Rejected Alternatives

### Keep the bootstrap CI workflow and postpone real quality tooling

Rejected because it would leave T01 mostly ceremonial and would not satisfy the requirement for a practical, runnable quality chain.

### Add a full contract-testing stack like Dredd, Schemathesis, or Prism now

Rejected because the repository does not yet expose a runnable service implementation. Contract assertions against the source OpenAPI artifact are enough for T01.

### Add container builds only to scan images

Rejected because it would expand T01 into runtime/build work reserved for later tasks and create misleading pseudo-deliverables.

## Outcome

The selected approach gives the repo a real quality baseline today:

- documentation linting
- contract artifact validation
- testable helper logic
- automated contract expectations
- dependency vulnerability auditing
- image supply-chain policy enforcement

This is narrow enough for T01 and extensible for future runtime-focused sibling tasks.
