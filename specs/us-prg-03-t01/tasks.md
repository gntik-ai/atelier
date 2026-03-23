# Tasks: CI Quality Pipeline and Reproducible Validation

**Input**: Design documents from `/specs/us-prg-03-t01/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `quickstart.md`

## Phase 1: Specification and planning

- [x] T001 Create `specs/us-prg-03-t01/spec.md` from the T01 specify prompt.
- [x] T002 Create `specs/us-prg-03-t01/plan.md` from the T01 plan prompt.
- [x] T003 Produce supporting delivery notes in `research.md`, `quickstart.md`, and this task list.

## Phase 2: Quality pipeline implementation

- [x] T004 Add root scripts and locked dev dependencies for markdown lint, OpenAPI validation, tests, and security checks.
- [x] T005 Add the minimal control-plane OpenAPI contract artifact required for real validation.
- [x] T006 Add reusable quality-gate helper logic plus image-policy and OpenAPI validation scripts.
- [x] T007 Add unit tests and contract tests tied to the actual contract artifact.
- [x] T008 Replace the bootstrap CI workflow with quality/security jobs, pnpm cache, and artifact upload.
- [x] T009 Add task-level delivery notes under `docs/tasks/us-prg-03-t01.md`.

## Phase 3: Validation

- [x] T010 Run local validation commands and record outcomes.

## Execution Notes

- Keep scope limited to the current repository state.
- Do not add runtime frameworks, container builds, or deployment CD steps yet.
- Treat image policy enforcement as the current image-security baseline until real images exist.
