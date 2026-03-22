# Working Conventions

## Repository organization

- `apps/` contains deployable applications.
- `services/` contains reusable service packages and operational configuration.
- `charts/` contains deployment packaging.
- `tests/e2e/` contains black-box workflow validation.
- `docs/adr/` stores architecture decision records.

## Delivery rules for early bootstrap

- prefer small, file-system-first increments
- avoid introducing runtime dependencies without a task that justifies them
- document intent before adding framework-specific complexity
- keep Kubernetes manifests portable and OpenShift-safe by default

## Quality gates

Every future feature should preserve at least:

1. documented purpose of new workspace additions
2. runnable root-level validation command
3. deployability path that remains compatible with Kubernetes and OpenShift
