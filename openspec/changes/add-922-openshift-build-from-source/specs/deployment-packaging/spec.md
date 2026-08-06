## ADDED Requirements

### Requirement: OpenShift build-from-source mode is documented
The system SHALL document `global.openshiftBuild` as an OpenShift-only opt-in and SHALL preserve pre-built image defaults when disabled.

#### Scenario: Disabled default
- **WHEN** no build values are supplied
- **THEN** operators use the existing GHCR or Harbor image paths.

#### Scenario: Enabled source build
- **WHEN** an operator enables the mode with a Git URI and webhook Secret
- **THEN** six BuildConfigs and ImageStreams build from the mirror and update workloads.

### Requirement: Source Dockerfiles are self-contained
Released service Dockerfiles SHALL build from a clean repository-root context without pre-generated artifacts.

#### Scenario: Clean checkout
- **WHEN** OpenShift builds web-console or fn-runtime from the repository root
- **THEN** the build completes using the tracked source paths.

### Requirement: Build mode exposes secure triggers and preserves defaults
The chart SHALL require Git URI and webhook Secret name when enabled, render six ConfigChange and
GitLab triggers, and leave all registry images unchanged when disabled.

#### Scenario: Push and initial build
- **WHEN** a valid GitLab push secret is delivered
- **THEN** the matching BuildConfig starts; ConfigChange starts the initial build.

#### Scenario: Invalid secret
- **WHEN** the webhook secret is incorrect
- **THEN** the webhook request is rejected and no Build starts.

### Requirement: Workloads consume completed streams safely
The chart SHALL annotate four Deployments for image change and SHALL use stream images for newly
created FN/MCP pods while preserving existing revisions.

#### Scenario: Completed build
- **WHEN** a stream tag receives a new digest
- **THEN** the four Deployments roll out and future FN/MCP pods use the stream pullspec.
