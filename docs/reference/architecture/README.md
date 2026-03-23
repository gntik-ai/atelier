# Architecture Reference Assets

This directory documents architecture baselines that future tasks should extend rather than replace.

## Current baseline

- `docs/adr/0003-control-plane-service-map.md` records the control-plane service split and dependency rules.
- `services/internal-contracts/src/internal-service-map.json` is the machine-readable source of truth for the internal service map and contract catalog introduced by `US-ARC-01-T01`.
- `docs/adr/0004-public-domain-environment-topology.md` records the public-domain, environment-profile, and deployment-topology decisions introduced by `US-ARC-02`.
- `services/internal-contracts/src/deployment-topology.json` is the machine-readable source of truth for environment profiles, platform parity, promotion, and smoke expectations.
- `docs/reference/architecture/deployment-topology.md` is the human-readable architecture companion for the deployment-topology contract.

## Usage rules

- Update the machine-readable source before adding new consumers.
- Keep provider-specific concerns behind adapter ports.
- Preserve append-only audit semantics.
- Preserve stable public route prefixes and explicit environment overlays when changing deployment topology.
- Add deliberate versioning notes when changing internal contract shapes.
