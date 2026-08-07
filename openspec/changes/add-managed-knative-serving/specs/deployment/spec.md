## ADDED Requirements

### Requirement: Knative runtime mode is explicit and observable

Falcone SHALL expose exactly one Knative runtime mode for an installation: `managed`, `external`, or
`disabled`. `managed` SHALL mean that Falcone exclusively owns a separately installed Knative Serving
and Kourier release; `external` SHALL mean that Falcone validates but never mutates a compatible
installation owned outside Falcone; `disabled` SHALL mean that no Knative-dependent workload can be
created or invoked. External validation SHALL use discovery plus read/invoke operations against an
administrator-supplied, pre-existing canary `ksvc`; it SHALL create no validation resource. Without a
readable and invokable canary, external readiness SHALL remain `unverified` and dependent workload
gates SHALL remain closed. The selected mode, owner, compatibility result, readiness state, version,
and last transition SHALL be available to platform operators and read-only auditors without granting
mutation rights.

#### Scenario: Managed mode is selected explicitly

- **WHEN** a cluster administrator selects `managed` mode for a supported clean installation
- **THEN** Falcone treats Knative as a separate managed installation phase and does not make it an
  unconditional dependency of the Falcone umbrella release

#### Scenario: External mode is read-only

- **WHEN** an installer selects `external` mode and supplies a compatible Knative installation
- **THEN** Falcone reports the external owner and compatibility state without creating, patching,
  upgrading, or deleting the external installation

#### Scenario: External canary is absent or unreadable

- **WHEN** external discovery succeeds but no pre-existing canary is supplied or Falcone cannot read
  and invoke the supplied canary with its normal application authority
- **THEN** readiness remains `unverified`, Function and hosted MCP workload gates stay closed, and no
  validation resource or cluster-scoped resource is mutated

#### Scenario: External version is incompatible

- **WHEN** external discovery reports a Knative or Kubernetes version outside the published matrix
- **THEN** compatibility fails with the detected and supported versions and no external resource is
  mutated

#### Scenario: Disabled mode is deliberate

- **WHEN** an installer selects `disabled` mode
- **THEN** Falcone reports Knative as disabled and continues to install non-Knative capabilities
  without claiming that Functions or hosted MCP runtimes are ready

#### Scenario: Read-only status does not grant mutation

- **WHEN** a P10 read-only auditor inspects the platform runtime status
- **THEN** the auditor can see mode, owner, version, readiness, and last transition but cannot change
  the mode or any Knative resource

### Requirement: Managed lifecycle executor and compatibility boundary are fixed

`managed` mode SHALL be operated by a versioned client-side lifecycle command shipped by
`gntik-ai/falcone-charts`, under the invoking cluster administrator's authority, against a separate
`falcone-knative` release. Falcone SHALL install no long-lived Operator or lifecycle controller for
this purpose. The command SHALL own staged CRD lifecycle, while the separate release and an ownership
record in `knative-serving` SHALL identify the rendered bundle owner. The initial supported matrix
SHALL be Knative Serving and Kourier 1.22.1 on Kubernetes 1.34 and OpenShift 4.21
`restricted-v2`; every other combination SHALL fail closed until independent acceptance updates the
published matrix. Falcone SHALL identify this patched upstream bundle as Falcone-supported on that
matrix and SHALL NOT represent it as the Red Hat-supported OpenShift Serverless product path.

#### Scenario: Managed lifecycle uses no Operator

- **WHEN** a cluster administrator installs, upgrades, rolls back, or uninstalls managed Knative
- **THEN** the versioned client-side lifecycle command operates the separate `falcone-knative`
  release and no OLM object or long-lived Falcone Operator is installed

#### Scenario: Initial matrix is accepted

- **WHEN** preflight detects Knative Serving/Kourier 1.22.1, Kubernetes 1.34, and OpenShift 4.21 with
  `restricted-v2`
- **THEN** the compatibility gate accepts that combination subject to authority and ownership checks

#### Scenario: Unvalidated platform combination fails closed

- **WHEN** preflight detects any Knative, Kourier, Kubernetes, or OpenShift combination absent from
  the published compatibility matrix
- **THEN** managed installation stops before mutation and identifies the unsupported combination

#### Scenario: Support status is represented accurately

- **WHEN** an operator inspects support metadata or documentation for a managed bundle
- **THEN** it identifies Falcone's bundle support and does not label the raw-manifest path as the Red
  Hat-supported OpenShift Serverless product

### Requirement: Managed mode fails closed on authority and ownership collisions

Before managed-mode mutation, Falcone SHALL verify the cluster-scoped permissions, Kubernetes
compatibility, admission reachability, namespaces, CRDs, RBAC, webhook configurations, storage
versions, and ownership markers required by the selected bundle. A clean installation SHALL acquire
one exclusive Falcone ownership identity. An existing installation SHALL require an explicit
`external`, `disabled`, or reviewed `managed` migration decision and SHALL never be adopted
implicitly. Any resource controlled by OLM, the OpenShift Serverless Operator, another raw-manifest
installation, or a different Falcone owner SHALL stop the managed installation before mutation.

#### Scenario: Clean cluster passes preflight

- **WHEN** a P18 installer with cluster-admin authority selects `managed` on a compatible cluster
  whose Knative resources are absent
- **THEN** preflight succeeds, records one Falcone owner identity, and authorizes the staged managed
  installation

#### Scenario: Namespace-only installer is denied before mutation

- **WHEN** an installer lacks permission to manage any required cluster-scoped resource
- **THEN** preflight fails with the missing permission and no Knative resource is mutated

#### Scenario: Existing Operator installation is not adopted

- **WHEN** preflight detects Knative resources owned by the OpenShift Serverless Operator or OLM
- **THEN** managed installation is rejected before mutation and the installer is directed to choose
  `external`, `disabled`, or an explicit handoff procedure

#### Scenario: Existing Falcone installation requires an explicit migration decision

- **WHEN** an existing Falcone deployment is upgraded and no runtime mode has been selected
- **THEN** the upgrade stops before changing Knative and requires the operator to select
  `external`, `disabled`, or a reviewed migration to `managed`

### Requirement: Managed bundle provenance and images are reproducible offline

Every managed bundle SHALL lock the upstream Knative and Kourier versions and source revisions,
manifest checksums, license inventory, SBOMs, and complete image inventory. Every image SHALL use an
immutable digest, including the Envoy gateway image, and SHALL support deterministic rewrite to a
configured private registry such as Harbor. Install, upgrade, and rollback SHALL perform no implicit
public-registry pull when disconnected mode is selected.

#### Scenario: Mutable image is rejected

- **WHEN** a managed bundle contains an image referenced only by a mutable tag such as
  `envoy:v1.37-latest`
- **THEN** bundle validation fails before installation and identifies the unpinned image

#### Scenario: Provenance lock is complete

- **WHEN** a release engineer validates a managed bundle
- **THEN** the locked upstream revision, manifest checksums, licenses, SBOMs, and every image digest
  resolve to one reproducible bundle

#### Scenario: Disconnected installation uses only the mirror

- **WHEN** a P18 installer selects disconnected managed mode with a Harbor mirror
- **THEN** every Knative and Kourier workload resolves its digest-pinned image from that mirror and
  the installation does not contact a public registry

### Requirement: Managed Knative is compatible with OpenShift restricted-v2

The managed OpenShift rendering SHALL allow the platform to assign an arbitrary namespace UID and
GID instead of fixing Kourier to `65534`. All containers in the Falcone-managed Knative
control-plane and Kourier data-plane bundle SHALL retain
`runAsNonRoot: true`, `allowPrivilegeEscalation: false`, `seccompProfile.type: RuntimeDefault`, and
all Linux capabilities dropped, and SHALL require no custom SCC or privileged service account.

#### Scenario: Kourier accepts the OpenShift-assigned UID

- **WHEN** Kourier is admitted under the namespace's OpenShift `restricted-v2` UID range
- **THEN** its pods start with the assigned non-root identity and no manifest requests
  `runAsUser: 65534` or `runAsGroup: 65534`

#### Scenario: Security controls remain enforced

- **WHEN** the managed manifests are rendered for OpenShift
- **THEN** every workload remains non-root, disallows privilege escalation, uses
  `RuntimeDefault` seccomp, drops all capabilities, and requests no custom SCC

### Requirement: Managed installation is staged and readiness-gated

Falcone SHALL install and verify the managed runtime in ordered stages: CRDs and establishment;
namespaces, service accounts, cluster RBAC, configuration, and Services; the Knative webhook
Deployment without AdmissionRegistration objects; webhook Service endpoint and generated certificate;
the three AdmissionRegistration configurations with non-empty CA bundles and a successful admission
probe; remaining Knative Serving controllers; Kourier control plane and gateway; then end-to-end
Knative Service readiness. No dependent controller, Knative custom-resource write, or downstream
Falcone workload SHALL proceed before its webhook/readiness prerequisites are healthy. A failed stage
SHALL identify the failed resource and preserve enough state for diagnosis without falsely reporting
availability.

#### Scenario: CRDs establish before controllers start

- **WHEN** a managed installation begins
- **THEN** Falcone waits for every required CRD to become Established before it applies resources
  whose controllers or webhooks depend on those CRDs

#### Scenario: Failure-policy webhooks are enabled only after their backend is ready

- **WHEN** the managed installer bootstraps Knative admission
- **THEN** it starts the webhook backend without AdmissionRegistration objects, waits for the Service
  endpoint and certificate, applies the configurations, and waits for non-empty CA bundles plus a
  successful admission probe before any dependent write

#### Scenario: Admission and data plane are proven before readiness

- **WHEN** the Serving and Kourier workloads appear available
- **THEN** Falcone creates an isolated smoke Knative Service, verifies Ready and cluster-internal
  invocation through Kourier, removes it, and only then reports the runtime ready

#### Scenario: A failed stage is not a successful install

- **WHEN** a webhook, controller, gateway, or smoke Knative Service fails its readiness deadline
- **THEN** the runtime enters an unavailable state naming the failed stage and downstream Functions
  and hosted MCP readiness remains false

### Requirement: Managed lifecycle has explicit upgrade, rollback, uninstall, and handoff boundaries

Managed upgrades SHALL advance at most one Knative minor version at a time, execute and verify every
required storage-version migration and post-upgrade job, and retain a recovery record before
mutation. Rollback SHALL be permitted only to a bundle compatible with the current CRD storage state;
after an irreversible storage migration, binary downgrade SHALL fail closed and require restore or
forward repair. Uninstall SHALL retain CRDs and tenant workload data by default, with destructive
purge requiring a separate explicit confirmation. A future handoff to an Operator SHALL be a
documented cutover with quiescence and ownership transfer; two reconcilers SHALL never own the same
installation simultaneously.

#### Scenario: Upgrade skips a minor version

- **WHEN** a P3 operator attempts to upgrade managed Knative across more than one minor version
- **THEN** the upgrade is rejected with the required intermediate version sequence

#### Scenario: Storage migration blocks incompatible downgrade

- **WHEN** an upgrade completed an irreversible CRD storage migration and the operator requests an
  incompatible binary rollback
- **THEN** rollback is refused and the recovery guidance identifies restore or forward repair

#### Scenario: Default uninstall retains durable API state

- **WHEN** an operator uninstalls the managed runtime without destructive-purge confirmation
- **THEN** Falcone removes only resources proven safe to remove, retains CRDs and tenant workload
  state, and reports the retained resources

#### Scenario: Operator handoff prevents simultaneous ownership

- **WHEN** an operator starts a handoff from Falcone-managed Knative to an Operator-managed runtime
- **THEN** Falcone records a backup, quiesces tenant writes, stops its lifecycle ownership while
  retaining CRDs/workloads, releases its ownership record, enables exactly one target owner, and
  verifies target readiness before resuming writes

#### Scenario: Handoff target fails after taking ownership

- **WHEN** the target owner has mutated resources but fails readiness during handoff
- **THEN** the installation remains quiesced for restore or forward repair and Falcone does not
  restart its old ownership concurrently

### Requirement: Runtime operations are isolated, audited, observable, and documented by persona

Mode changes, installation stages, upgrades, rollbacks, handoffs, uninstall, failed preflights, and
ownership collisions SHALL emit secret-safe platform audit events and bounded operational metrics.
Cluster-runtime authority SHALL remain restricted to P18 installers, P3 operators, and an explicit
cluster-admin boundary; P8 function developers, P7 MCP owners, P12 MCP consumers, P10 auditors, P13
adjacent tenants, and P17 documentation-only users SHALL gain no cluster-scoped mutation path. Guides
and runbooks SHALL describe each persona's supported actions, disabled/degraded behavior, air-gap
procedure, support boundary, recovery, and evidence collection without claiming managed availability
until clean-cluster acceptance passes.

#### Scenario: Lifecycle mutation is audited without secrets

- **WHEN** an authorized operator changes mode or executes a managed lifecycle action
- **THEN** an audit event records actor, action, target bundle, owner, result, and correlation ID
  without credentials, tokens, kubeconfig contents, or unbounded resource payloads

#### Scenario: Adjacent tenant cannot observe or mutate the runtime

- **WHEN** a P13 principal from another tenant probes Knative runtime status or cluster resources
- **THEN** no cluster mutation path or tenant-specific workload metadata is disclosed

#### Scenario: Developer receives actionable availability status

- **WHEN** a P8 function developer or P7/P12 MCP user encounters a disabled or degraded runtime
- **THEN** the user sees a stable dependency status and correlation ID but no cluster secrets or
  administrative controls

#### Scenario: Documentation-only user sees the support boundary

- **WHEN** a P17 user reads installation or operations documentation before implementation acceptance
- **THEN** the documentation labels managed Knative as proposed and describes Operator-free support
  boundaries without claiming it is live
