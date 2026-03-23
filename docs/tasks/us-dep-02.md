# US-DEP-02 — Bootstrap controller, secret resolution, and upgrade-safe seeding

## What changed

- Added a Helm-managed bootstrap controller job that runs on install and upgrade.
- Split bootstrap behavior into explicit **create-only** and **reconcile-on-upgrade** phases.
- Added ConfigMap-based **lock** and **marker** resources to block concurrent runs and to skip duplicate one-shot work.
- Added a bootstrap payload ConfigMap that carries the desired seed state for:
  - platform Keycloak realm
  - superadmin account + role
  - governance catalog seed (`plans`, `quota policies`, `deployment profiles`)
  - internal OpenWhisk/storage namespace and prefix catalog
  - base APISIX routes
- Added a dedicated internal APISIX admin Service for cluster-local bootstrap reconciliation.
- Added values/schema/docs/tests/validators for secret resolution and restore/reinstall safety.

## Secret strategy

Sensitive inputs are modeled under `bootstrap.secretResolution.sources` and may resolve from:

- Kubernetes Secrets
- pre-injected environment variables
- external secret references documented in values metadata

Plaintext credentials remain forbidden in repository-tracked values.

## Safety and lifecycle rules

- one-shot resources are created only when missing
- upgrade reconciliation still runs when one-shot resources are already marked complete
- reinstall and restore flows recreate only missing create-only resources
- concurrent bootstrap runs fail fast when the lock exists

## Validation touchpoints

- `npm run validate:deployment-topology`
- `npm run validate:deployment-chart`
- `npm run test:unit`
- `npm run test:contracts`
- `npm run test:e2e:deployment`
