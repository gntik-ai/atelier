# US-PRG-01-T01 Task Breakdown

## Specify summary

Create the initial monorepo structure with base folders for control plane, gateway configuration, service adapters, web console, Helm charts, documentation, and end-to-end tests. Keep the first increment explicit and lightweight.

## Executable plan

1. Establish root workspace files and validation scripts.
2. Create top-level app, service, chart, docs, and test directories with minimal package/readme placeholders.
3. Define working conventions and a bootstrap ADR.
4. Replace the default Spec Kit constitution with project-specific repository rules.
5. Add a minimal CI workflow that enforces the bootstrap quality gate.
6. Run repository validation commands and record results.

## Concrete implementation tasks

- [x] Add `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.gitignore`.
- [x] Add root structure validator under `scripts/`.
- [x] Create `apps/control-plane` and `apps/web-console` placeholders.
- [x] Create `services/gateway-config` and `services/adapters` placeholders.
- [x] Create `charts/in-atelier` Helm chart skeleton.
- [x] Add `docs/conventions.md`, `docs/README.md`, and ADR-0001.
- [x] Add `tests/e2e` placeholder workspace.
- [x] Add `.github/workflows/ci.yml` bootstrap workflow.
- [x] Replace `.specify/memory/constitution.md` with project-specific conventions.
