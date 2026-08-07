## 1. Baseline and contract

- [ ] T01 Record a green baseline for both repositories and a secret-safe inventory of the target
  Kubernetes/OpenShift versions, existing Knative ownership, required cluster-scoped permissions,
  and disposable acceptance environment.
- [ ] T02 Provision the unresolved acceptance prerequisite: a disposable, cluster-admin-controlled
  remote OpenShift 4.21 environment. The client-side lifecycle executor, separate release ownership,
  initial 1.22.1/Kubernetes 1.34 matrix, and Falcone-versus-Red-Hat support boundary are fixed by the
  design and SHALL NOT be re-decided during implementation.
- [x] T03 Create linked implementation issues and coordinated release milestones in
  `gntik-ai/falcone` ([#933](https://github.com/gntik-ai/falcone/issues/933)) and
  `gntik-ai/falcone-charts` ([#8](https://github.com/gntik-ai/falcone-charts/issues/8)), referencing
  issue #932 and the air-gapped build-from-source work (`gntik-ai/falcone#929` and
  `gntik-ai/falcone-charts#6`).

## 2. Chart-side managed bundle (`gntik-ai/falcone-charts`)

- [ ] T04 Vendor a reviewed Knative Serving and Kourier release with an upstream revision,
  original/patched manifest checksums, license inventory, SBOMs, and a complete image lock.
- [ ] T05 Replace every mutable image reference, including the current Envoy tag, with an immutable
  digest and implement deterministic Harbor/private-registry rewrites with no public-registry pulls.
- [ ] T06 Implement explicit `managed`, `external`, and `disabled` values plus compatibility
  validation; do not make the managed bundle an unconditional umbrella-chart dependency.
- [ ] T07 Implement fail-closed preflight for Kubernetes compatibility, cluster-scoped authority,
  CRD/storage state, existing namespaces/resources, and exclusive Operator/raw/Falcone ownership.
- [ ] T08 Implement ordered CRD establishment; namespace/RBAC/configuration/Service; webhook backend
  endpoint/certificate; AdmissionRegistration CA/admission probe; remaining Serving; Kourier; and
  smoke `ksvc` phases with bounded readiness, diagnostics, and cleanup behavior.
- [ ] T09 Patch Kourier for OpenShift by removing fixed UID/GID and retaining non-root,
  no-privilege-escalation, `RuntimeDefault` seccomp, and dropped capabilities; require no custom SCC.
- [ ] T10 Implement one-minor upgrade orchestration, required storage migrations, compatibility-aware
  rollback, recovery records, retain-by-default uninstall, explicit purge, and owner-safe handoff.
- [ ] T11 Add chart/render/policy tests for Kubernetes and OpenShift, collision cases, digest-only
  images, disconnected Harbor, `restricted-v2`, install ordering, upgrades, rollback, and uninstall.

## 3. Falcone runtime and public contract (`gntik-ai/falcone`)

- [ ] T12 Add source-of-truth runtime-mode/readiness configuration and operator/read-only status,
  with generated contracts/clients kept in sync and mutation limited to platform authority.
- [ ] T13 Gate Function deploy, update, invoke, rollback, and readiness before Knative work; implement
  `503 KNATIVE_UNAVAILABLE`, preserve `501 FUNCTIONS_DISABLED`, and make outage-time delete return
  `202 deletion_pending` with an atomic cleanup obligation.
- [ ] T14 Gate hosted MCP publish, activate, invoke, and readiness; implement the HTTP `503` management
  and HTTP `200`/JSON-RPC `-32005` unavailable contracts, notification/authentication precedence, and
  `202 deletion_pending` cleanup while keeping disabled hosting distinguishable.
- [ ] T15 Implement durable, idempotent pending cleanup for Function and MCP teardown during runtime
  outages and prove that recovery removes only Falcone-owned resources.
- [ ] T16 Add secret-safe audit events and bounded metrics for mode, preflight, lifecycle stages,
  availability failures, deferred cleanup, recovery, and ownership collisions.
- [ ] T17 Add console status, disabled/degraded affordances, permission boundaries, correlation IDs,
  keyboard/focus behavior, live-region announcements, reflow, and WCAG 2.2 AA tests.
- [ ] T18 Preserve namespace/RBAC/NetworkPolicy/gateway isolation for same-named Function and MCP
  workloads across adjacent tenants, including teardown and outage adversarial tests.

## 4. Documentation and operations

- [ ] T19 Document clean `managed`, existing `external`, and `disabled` installs; cluster-admin
  prerequisites; Harbor mirroring; `restricted-v2`; support boundaries; and version compatibility.
- [ ] T20 Publish detailed preflight, install, readiness, upgrade, rollback/forward-repair, handoff,
  uninstall/explicit-purge, outage recovery, evidence collection, and troubleshooting runbooks.
- [ ] T21 Keep current prerequisite documentation authoritative until both implementation repositories
  pass acceptance; do not advertise managed mode from this design-only change.

## 5. Acceptance and independent verification

- [ ] T22 Run a disposable clean Kubernetes install and a cluster-admin-controlled remote OpenShift
  install without OLM/Serverless Operator; prove all workloads run under `restricted-v2` and remove
  every disposable resource afterward.
- [ ] T23 In mirror-only mode, prove that install, smoke service, Function, MCP, upgrade, rollback, and
  recovery pull every image by digest from Harbor and make no public registry request.
- [ ] T24 Execute persona journeys for P18/P3/P8/P7/P12/P10/P13/P17, covering Function
  deploy/invoke/version/rollback/delete; MCP publish/invoke/scale-to-zero/teardown; unavailable and
  disabled states; read-only access; and adjacent-tenant non-disclosure.
- [ ] T25 Independently verify API/UI/backend/chart/cluster side effects, authorization and tenant
  isolation, contracts, accessibility, observability, documentation, upgrade, rollback, handoff,
  uninstall retention, explicit purge, and cleanup proof.
- [ ] T26 Run strict OpenSpec validation, repository validation, chart tests, black-box tests, and
  real-stack Playwright E2E; record and resolve every regression before release.
- [ ] T27 Archive/sync the OpenSpec change only after all tasks, coordinated implementations,
  disposable-environment cleanup, and independent reviews are complete.
