# US-STO-03 — Storage credentials, usage reporting, import/export, auditability, and provider operability guidance

## Scope delivered in this increment

This increment closes the remaining documentation slice of the US-STO-03 storage story by adding a
human-readable operator guide for supported storage providers.

Delivered artifacts:

- `docs/reference/architecture/storage-provider-operability.md`
- `docs/reference/architecture/README.md` update for discoverability
- `specs/024-storage-provider-guidance/{spec,plan,tasks}.md`

## Main decisions

### Provider guidance is now explicit and repository-local

The repository now includes one storage provider operability guide that explains:

- support posture for MinIO, Ceph RGW, and Garage,
- platform-visible planning limits,
- the internal SLA/SLO envelope for routine operation and degraded mode,
- and qualitative cost / operator-burden trade-offs.

### Internal targets are documented as platform objectives, not external guarantees

The new guide makes it explicit that storage latency, freshness, and credential-hygiene statements
are internal operating objectives for the Falcone platform team. They are not vendor guarantees or
customer-facing contractual SLAs.

### Deployment-dependent capability posture stays visible

Ceph RGW remains a conditional profile for some advanced capabilities, and Garage remains a
constrained profile for feature-complete workloads. The guide preserves those distinctions instead of
flattening everything into a single generic storage promise.

## Residual limitation carried forward

This task does not change runtime behavior, public routes, or capability evaluation logic. It makes
previously delivered storage behavior more operable and discoverable, but any future provider change
must keep the guide in sync with `services/adapters/src/storage-provider-profile.mjs`.
