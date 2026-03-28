# Architecture Reference Assets

This directory documents architecture baselines that future tasks should extend rather than replace.

## Current baseline

- `docs/adr/0003-control-plane-service-map.md` records the control-plane service split and dependency rules.
- `services/internal-contracts/src/internal-service-map.json` is the machine-readable source of truth for the internal service map and contract catalog introduced by `US-ARC-01-T01`.
- `docs/adr/0004-public-domain-environment-topology.md` records the public-domain, environment-profile, and deployment-topology decisions introduced by `US-ARC-02`.
- `services/internal-contracts/src/deployment-topology.json` is the machine-readable source of truth for environment profiles, platform parity, promotion, and smoke expectations.
- `docs/reference/architecture/deployment-topology.md` is the human-readable architecture companion for the deployment-topology and bootstrap-policy contract.
- `charts/in-atelier/README.md` is the operator guide for packaging, layered values, bootstrap, upgrade, rollback, and restore of the deployment chart.
- `docs/adr/0005-contextual-authorization-model.md` records the multi-tenant, multi-workspace authorization decision baseline introduced by `US-ARC-03`.
- `services/internal-contracts/src/authorization-model.json` is the machine-readable source of truth for security context, role scopes, resource ownership, propagation, and negative authorization coverage.
- `docs/reference/architecture/contextual-authorization.md` is the human-readable architecture companion for the authorization model.
- `docs/reference/architecture/gateway-realtime-and-event-gateway.md` records the gateway baseline for APISIX metrics, SSE/WebSocket channels, and the HTTP event gateway introduced by `US-GW-04`.
- `docs/adr/0006-core-domain-entity-model.md` records the canonical entity, relationship, and lifecycle decision baseline introduced by `US-DOM-01`.
- `services/internal-contracts/src/domain-model.json` is the machine-readable source of truth for shared identifiers, entity relationships, lifecycle events, and OpenAPI mapping metadata.
- `docs/reference/architecture/core-domain-model.md` is the human-readable architecture companion for the core domain model.
- `docs/reference/architecture/console-authentication.md` records the console login, signup, activation, and password-recovery baseline introduced by `US-IAM-03`.
- `docs/reference/architecture/storage-provider-operability.md` records the supported storage provider posture, planning limits, internal operating targets, and qualitative cost guidance introduced by `US-STO-03-T06`.
- `services/internal-contracts/src/observability-metrics-stack.json` is the machine-readable source of truth for the unified observability metrics plane, including subsystem coverage, normalized metric families, selector labels, collection health, and collection topology.
- `docs/reference/architecture/observability-metrics-stack.md` is the human-readable architecture companion for the unified observability metrics baseline introduced by `US-OBS-01-T01`.
- `services/internal-contracts/src/observability-dashboards.json` is the machine-readable source of truth for the canonical observability health dashboard hierarchy, scope semantics, widget catalog, and workspace fallback behavior introduced by `US-OBS-01-T02`.
- `docs/reference/architecture/observability-health-dashboards.md` is the human-readable architecture companion for the observability dashboard baseline introduced by `US-OBS-01-T02`.
- `services/internal-contracts/src/observability-health-checks.json` is the machine-readable source of truth for the canonical component liveness, readiness, and health baseline introduced by `US-OBS-01-T03`.
- `docs/reference/architecture/observability-health-checks.md` is the human-readable architecture companion for the observability health-check baseline introduced by `US-OBS-01-T03`.

## Usage rules

- Update the machine-readable source before adding new consumers.
- Keep provider-specific concerns behind adapter ports.
- Preserve append-only audit semantics.
- Preserve stable public route prefixes, explicit environment overlays, and the documented Helm values layer order when changing deployment topology.
- Preserve deny-by-default tenant/workspace authorization, explicit delegation limits, and end-to-end correlation when changing the authorization model.
- Preserve canonical identifier prefixes, parent-child integrity, and soft-delete semantics when changing the core domain model.
- Preserve auditable membership/invitation records, safe plan-change evaluation, and explicit plane labels when changing the governance model.
- Add deliberate versioning notes when changing internal contract shapes.
