# Working Conventions

## Repository organization

- `apps/` contains deployable applications.
- `services/` contains reusable service packages and operational configuration.
- `charts/` contains deployment packaging.
- `tests/e2e/` contains black-box workflow validation.
- `docs/adr/` stores architecture decision records.
- `services/internal-contracts/` stores machine-readable internal boundary and contract metadata for shared use across modules.

## Delivery rules for early bootstrap

- prefer small, file-system-first increments
- avoid introducing runtime dependencies without a task that justifies them
- document intent before adding framework-specific complexity
- keep Kubernetes manifests portable and OpenShift-safe by default
- keep public route prefixes stable across environments; vary only approved profile, hostname, certificate, and secret-reference settings

## Quality gates

Every future feature should preserve at least:

1. documented purpose of new workspace additions
2. runnable root-level validation commands
3. markdown and contract artifacts that can be checked in CI
4. API versioning rules that remain explicit and testable
5. supply-chain checks for dependencies and declared deployable images
6. deployability path that remains compatible with Kubernetes and OpenShift
7. internal boundary and contract metadata that remain machine-checkable as the control plane grows
8. deployment topology, environment-profile, and promotion rules that remain machine-checkable as the platform expands
