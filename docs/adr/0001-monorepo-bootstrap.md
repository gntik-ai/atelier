# ADR 0001: Bootstrap monorepo structure

## Status

Accepted

## Context

The project needs a monorepo layout that separates deployable apps, shared services, operational configuration, deployment packaging, documentation, and end-to-end tests while remaining intentionally lightweight during the bootstrap phase.

## Decision

Adopt a `pnpm` workspace monorepo with these top-level domains:

- `apps/` for deployable product surfaces
- `services/` for reusable backend/supporting modules and gateway configuration
- `charts/` for Helm-based Kubernetes/OpenShift packaging
- `docs/` for conventions and architecture decisions
- `tests/e2e/` for black-box validation

Add lightweight root scripts that validate the required repository skeleton before functional code exists.

## Consequences

### Positive

- creates a stable place for sibling tasks T02-T06
- makes delivery intent explicit early
- supports CI and packaging placeholders without overcommitting to implementation details

### Negative

- quality gates are structural rather than behavioral at this stage
- application packages remain placeholders until later tasks introduce real runtime code
