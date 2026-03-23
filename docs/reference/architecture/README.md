# Architecture Reference Assets

This directory documents architecture baselines that future tasks should extend rather than replace.

## Current baseline

- `docs/adr/0003-control-plane-service-map.md` records the control-plane service split and dependency rules.
- `services/internal-contracts/src/internal-service-map.json` is the machine-readable source of truth for the internal service map and contract catalog introduced by `US-ARC-01-T01`.
- `docs/adr/0004-public-domain-environment-topology.md` records the public-domain, environment-profile, and deployment-topology decisions introduced by `US-ARC-02`.
- `services/internal-contracts/src/deployment-topology.json` is the machine-readable source of truth for environment profiles, platform parity, promotion, and smoke expectations.
- `docs/reference/architecture/deployment-topology.md` is the human-readable architecture companion for the deployment-topology contract.
- `docs/adr/0005-contextual-authorization-model.md` records the multi-tenant, multi-workspace authorization decision baseline introduced by `US-ARC-03`.
- `services/internal-contracts/src/authorization-model.json` is the machine-readable source of truth for security context, role scopes, resource ownership, propagation, and negative authorization coverage.
- `docs/reference/architecture/contextual-authorization.md` is the human-readable architecture companion for the authorization model.
- `docs/adr/0006-core-domain-entity-model.md` records the canonical entity, relationship, and lifecycle decision baseline introduced by `US-DOM-01`.
- `services/internal-contracts/src/domain-model.json` is the machine-readable source of truth for shared identifiers, entity relationships, lifecycle events, and OpenAPI mapping metadata.
- `docs/reference/architecture/core-domain-model.md` is the human-readable architecture companion for the core domain model.

## Usage rules

- Update the machine-readable source before adding new consumers.
- Keep provider-specific concerns behind adapter ports.
- Preserve append-only audit semantics.
- Preserve stable public route prefixes and explicit environment overlays when changing deployment topology.
- Preserve deny-by-default tenant/workspace authorization, explicit delegation limits, and end-to-end correlation when changing the authorization model.
- Preserve canonical identifier prefixes, parent-child integrity, and soft-delete semantics when changing the core domain model.
- Add deliberate versioning notes when changing internal contract shapes.
