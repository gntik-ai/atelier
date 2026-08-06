## ADDED Requirements

### Requirement: The OpenShift guide documents an operator-complete source-build path

The OpenShift install guide SHALL document the OpenShift-only `global.openshiftBuild` path from
prerequisite validation through installation, initial builds, GitLab Push webhook registration,
ImageStream verification, automatic rollout, runtime-image behavior, troubleshooting, and rollback.
It SHALL state that public or Harbor prebuilt images remain the default.

#### Scenario: Operator can install from the guide alone

- **WHEN** an operator has a reachable GitLab mirror and follows the source-build section
- **THEN** the operator can create the required Secret references, layer the documented values on
  the OpenShift profile, install the chart, and observe the six initial builds without consulting
  implementation source

#### Scenario: Operator can verify automation end to end

- **WHEN** the operator registers the documented Push webhooks and pushes a commit to the configured
  ref
- **THEN** the guide provides commands that identify the webhook-triggered Build, resulting
  ImageStreamTag pullspec and digest, and corresponding Deployment rollout without a Helm operation

### Requirement: The values reference is complete and secret-safe

The Helm configuration reference SHALL document the type, default, conditional requirement,
purpose, precedence, and security boundary of every `global.openshiftBuild` key:
`enabled`, `git.uri`, `git.ref`, `git.sourceSecret`, `webhookSecret`, `tag`, common Build resources,
and web-console-specific Build resources.

#### Scenario: Reader looks up every build value

- **WHEN** a reader opens the OpenShift build-from-source values reference
- **THEN** all image/source keys and their defaults `false`, `""`, `main`, `""`, `""`, and `latest`
  are present, the common `128Mi`/`1Gi` and web-console `512Mi`/`3Gi` resource defaults are present,
  and Secret values are not represented as Helm values

### Requirement: Disabled mode preserves prebuilt-image behavior

The build-from-source mode SHALL default to disabled. When disabled, the chart SHALL render no
BuildConfigs, ImageStreams, or image-change annotations and SHALL leave configured public or private
registry image references unchanged.

#### Scenario: Default chart render

- **WHEN** the chart is rendered without build-from-source overrides
- **THEN** zero OpenShift Build API objects are present and released services retain their existing
  repository, tag, or digest image contracts

### Requirement: Enabled mode creates one source build per released service

When enabled with a Git URI and webhook Secret reference, the chart SHALL render exactly one
Docker-strategy BuildConfig and one ImageStream for each released catalog service:
`control-plane`, `control-plane-executor`, `web-console`, `workflow-worker`, `mcp-runtime`, and
`fn-runtime`. Each BuildConfig SHALL use its catalog Dockerfile path, configured Git ref and optional
same-Project source Secret, output tag, a `ConfigChange` trigger, and a secret-referenced GitLab
trigger.

BuildConfig resource requirements SHALL be configurable. The default common memory request and
limit SHALL be `128Mi` and `1Gi`; the web-console BuildConfig SHALL merge a `512Mi` request and
`3Gi` limit override so its source-only Vite build can complete under a Project LimitRange.

#### Scenario: Install starts all initial builds

- **WHEN** the enabled resources are first created
- **THEN** exactly six ConfigChange-caused Builds start and target the six corresponding stream tags

#### Scenario: Web console receives its build budget

- **WHEN** enabled resources are rendered with default resource values
- **THEN** five BuildConfigs receive the common `128Mi`/`1Gi` memory budget and web-console receives
  the merged `512Mi`/`3Gi` budget

#### Scenario: Enabled configuration lacks required references

- **WHEN** the mode is enabled without either `git.uri` or `webhookSecret`
- **THEN** Helm rejects the configuration before resources are installed

### Requirement: GitLab webhook authentication gates builds

Each BuildConfig SHALL expose a GitLab webhook authenticated by the referenced
`WebHookSecretKey`, without rendering that key's bytes.

#### Scenario: Correct GitLab Push secret

- **WHEN** GitLab delivers a valid Push payload to one BuildConfig webhook with the correct secret
- **THEN** exactly one additional Build starts for that matching BuildConfig with a GitLab webhook
  cause

#### Scenario: Incorrect GitLab Push secret

- **WHEN** the same payload is delivered with an incorrect secret
- **THEN** OpenShift rejects the request and no additional Build is created

### Requirement: Completed stream builds update the correct consumers

The chart SHALL add image-change triggers to the four Deployment-backed services and SHALL configure
the function and MCP runtime image values with their internal ImageStream pullspecs.

#### Scenario: Deployment-backed stream changes

- **WHEN** one of the `control-plane`, `control-plane-executor`, `web-console`, or `workflow-worker`
  stream tags receives a new image
- **THEN** only its matching Deployment receives the image update and rolls out without a Helm
  operation

#### Scenario: Dynamic runtime stream changes

- **WHEN** the `fn-runtime` or `mcp-runtime` stream tag receives a new image
- **THEN** newly created function or MCP pods use the updated stream image while existing pods or
  revisions remain unchanged

### Requirement: Released source Dockerfiles build from the repository root

Released service Dockerfiles SHALL build from a clean repository-root Docker context without
requiring a pre-generated host artifact, while preserving their numeric-non-root runtime contracts.

#### Scenario: Web console source build

- **WHEN** OpenShift builds `apps/web-console/Dockerfile` from a clean monorepo checkout
- **THEN** a locked pnpm builder stage produces `dist` and the final runtime stage contains the
  generated bundle without the builder dependencies

#### Scenario: Function runtime source build

- **WHEN** OpenShift builds `apps/fn-runtime/Dockerfile` from the monorepo root
- **THEN** the tracked `apps/fn-runtime/server.mjs` is copied into the final numeric-non-root image
