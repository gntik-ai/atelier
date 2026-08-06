## ADDED Requirements

### Requirement: Service container builds support base-image override

Every `FROM` stage in the Dockerfiles of `release: true` services SHALL be overridable through
documented build args whose defaults preserve the current base images, and `service-catalog.json`
SHALL record each released service's base-image args and default values. The service-catalog
validator SHALL fail deterministically when a Dockerfile `FROM` is not parameterized, when a
released service omits its base-image metadata, or when a recorded default drifts from the Dockerfile
`ARG` default.

#### Scenario: An overridden build pulls no external base image

- **WHEN** a service image is built with all of its base-image args pointing at a private registry
- **THEN** every `FROM` stage resolves to that registry and base layers are pulled only from it

#### Scenario: Default builds are unchanged

- **WHEN** a service image is built without base-image overrides
- **THEN** the resulting image uses the same base images as before this change and
  `release-images.yml` publishes it unmodified

#### Scenario: The catalog lists the build args

- **WHEN** `service-catalog.json` is read
- **THEN** each `release: true` service lists its base-image build args and their defaults, matching
  the `ARG` defaults declared in its Dockerfile

#### Scenario: The catalog is the source of truth for drift

- **WHEN** a Dockerfile reintroduces a literal `FROM`, a released service loses its `baseImageArgs`,
  or a recorded default no longer equals the Dockerfile `ARG` default
- **THEN** `pnpm validate:service-catalog` reports the specific base-image violation and exits
  non-zero

### Requirement: The OpenShift install guide documents the disconnected build-from-source mode

`docs-site/operations/openshift-install.md` SHALL document installing the Falcone services with
images built by OpenShift Builds on a cluster whose only reachable endpoints are a local Git mirror
and a private registry, covering prerequisites (including the required Node base images copied into
Harbor and a package-registry mirror for build-time dependency fetches), the enabling Helm values
with base-image overrides, GitLab webhook registration, and end-to-end verification of the push,
build, and rollout chain. `docs-site/operations/helm-configuration.md` SHALL document the
`global.openshiftBuild.*` base-image values, truthfully scoped to the coordinated companion chart
capability.

#### Scenario: An operator can set up the mode from the guide alone

- **WHEN** an operator follows the build-from-source section on a disconnected cluster with only the
  local GitLab and the private registry reachable
- **THEN** they reach a running installation whose service images come from in-cluster Builds,
  without consulting sources outside the documentation

#### Scenario: An operator can verify the automation end to end

- **WHEN** the operator pushes a commit to the mirror and runs the documented verification commands
- **THEN** they can observe the triggered Build, the updated `ImageStreamTag`, and the automatic
  Deployment rollout, and know that `fn-runtime`/`mcp-runtime` pick up new builds on the next
  launched pod

#### Scenario: The values reference covers the new keys

- **WHEN** a reader looks up `global.openshiftBuild.*` in `helm-configuration.md`
- **THEN** each base-image key is documented with its purpose and default, the required companion
  chart version/dependency is stated, and no unavailable key is presented as already released
