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
