# End-to-End Tests

Reserved for black-box validation of platform workflows.

## Current scaffolding

- `console/` contains actor/state-oriented executable scaffolding for future console journeys.
- `observability/` contains executable smoke scaffolding for observability scraping, dashboard, and health-state parity, plus the audit traceability and sensitive-data verification baseline from `US-OBS-02-T06`.
- `postgresql-tenant-isolation/` contains the reusable tenant-isolation verification matrix from `US-PRG-02-T01`.

## Testing-pyramid role

This directory is the home for `console_e2e` coverage in the testing strategy package. Current tests validate the state/permission contract and route intent without selecting a browser framework yet.

## Initial targets for future tasks

- control plane health flow
- observability smoke verification
- audit traceability and masking verification
- web console navigation and permission journeys
- gateway configuration propagation
- multi-step tenant lifecycle workflows
