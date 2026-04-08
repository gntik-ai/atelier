# Storage Provider Operability Guide

This guide turns the existing storage provider abstraction into an operator-facing reference for
backend selection, rollout review, and day-two support.

It is intentionally limited to the providers already represented in the repository capability model:

- `minio`
- `ceph-rgw`
- `garage`

The guide documents four things:

1. provider support posture,
2. platform-visible planning limits,
3. internal SLA/SLO targets for routine operation,
4. and qualitative cost / operator-burden trade-offs.

> Internal scope note:
> The targets below are internal operating objectives for the Falcone platform team. They are not
> external customer-facing SLAs and they do not replace provider-specific runbooks or deployment
> validation.

## 1. Provider comparison at a glance

| Provider | Support posture | Advanced capability posture | Best fit | Main caution |
| --- | --- | --- | --- | --- |
| MinIO | Primary / default | Fully satisfied across the current abstraction | General-purpose multi-tenant storage, feature-rich environments, audit-heavy workloads | Higher feature coverage usually comes with a larger platform footprint than the lightest profiles |
| Ceph RGW | Conditional / deployment-validated | Versioning, lifecycle, object lock, and event notifications are deployment-dependent | Environments already standardized on Ceph operations | Advanced capability behavior must be validated per environment before rollout |
| Garage | Constrained / lightweight | Versioning, lifecycle, object lock, and event notifications are not assumed | Smaller footprint or edge-style deployments needing the baseline storage abstraction | Do not choose it for workloads that require the full advanced feature set |

## 2. Platform-visible planning limits

These are the planning constraints already visible in the normalized storage abstraction. Treat them
as platform limits unless a stricter environment-specific runbook says otherwise.

| Constraint | Current platform guidance | Notes |
| --- | --- | --- |
| Object key length | `<= 1024` characters | Shared across the current provider profiles |
| Multipart part count | `<= 10000` parts | Exposed as the stable multipart planning ceiling |
| Maximum object size | Provider-defined | Production onboarding must record the tested ceiling for the chosen deployment |
| Object listing pagination | Deterministic, lexicographic ordering with opaque continuation token | Keep client logic aligned to the normalized abstraction rather than provider-specific token formats |
| Conditional object reads/writes | `If-Match` and `If-None-Match` supported in the common profile | Required for safe overwrite / caching semantics |
| Bucket policy evaluation | Platform-governed | Do not assume raw provider-native policy semantics are exposed directly |
| Event notification delivery targets | Kafka and/or OpenWhisk when supported | Support still depends on provider capability posture |

## 3. Internal SLA / SLO envelope

The storage surface is now expected to behave like a supportable platform capability. The following
internal targets define the healthy operating envelope.

### 3.1 Common control-plane targets

| Operational flow | Internal target | Notes |
| --- | --- | --- |
| Provider introspection and capability reads | P95 `<= 1s` | Applies to normalized provider/profile reads, not live provider benchmarking |
| Bucket and object metadata reads | P95 `<= 2s` | Includes list/get/head-style control-plane reads under normal provider health |
| Bucket creation, deletion, and governed object mutations | P95 `<= 5s`, investigate sustained P95 `> 10s` | Longer spikes may occur during provider-side maintenance; sustained regression requires review |
| Credential rotation / revocation visibility | Propagation expectation `<= 5m` | Use existing audit and credential surfaces to confirm completion |
| Usage snapshot freshness | Fresh snapshot target `<= 15m`; warn after `15m`; investigate after `30m` | Cached or degraded snapshots must remain visibly marked |
| Audit/event projection lag for storage admin operations | Investigate sustained lag `> 5m` | Applies to platform-side audit visibility, not provider-native logs |

### 3.2 Degraded-mode expectations

- `provider_unavailable` usage snapshots must remain explicit and must not be interpreted as zero
  usage.
- Deployment-dependent features must be treated as **not production-ready** until the environment's
  runbook records the validated behavior.
- If credential rotation or revocation takes longer than the target window, treat it as an
  operational incident because access hygiene is security-sensitive.
- If advanced capabilities drift from the documented profile after an upgrade, re-run provider
  validation before reopening rollout.

## 4. Provider profiles

### 4.1 MinIO (`minio`)

**Support posture**: Primary / default profile.

MinIO is the reference provider for the current storage abstraction. It satisfies the full baseline
plus the currently modeled advanced capability set:

- presigned URLs,
- multipart uploads,
- object versioning,
- bucket policies,
- bucket lifecycle,
- object lock,
- event notifications.

**Operational guidance**

- Prefer MinIO when a tenant or workspace needs the full storage feature envelope without
  deployment-specific caveats.
- Use it as the default choice for product demos, mainline CI expectations, and environments where
  versioning, lifecycle, and audit-friendly governance are expected to behave consistently.
- Treat MinIO as the least surprising profile when introducing new storage-facing product features.

**Internal SLA caveats**

- The common internal targets in section 3 are expected to be directly achievable with MinIO under a
  healthy deployment.
- Sustained misses are usually a deployment sizing or backing-storage issue, not a capability-model
  ambiguity.

**Cost / operator-burden posture**

- Best feature-to-surprise ratio for the current product surface.
- Usually a higher infrastructure and operational footprint than the lightest profile, but it avoids
  follow-up engineering cost caused by unsupported advanced features.
- Prefer this profile when the cost of feature gaps or operator ambiguity is higher than the cost of
  running a richer storage stack.

### 4.2 Ceph RGW (`ceph-rgw`)

**Support posture**: Conditional / deployment-validated profile.

Ceph RGW satisfies the baseline abstraction and the following advanced capabilities with no special
warning in the current model:

- presigned URLs,
- multipart uploads,
- bucket policies.

The following advanced capabilities are **deployment-dependent** in the repository's capability
model:

- object versioning,
- bucket lifecycle,
- object lock,
- event notifications.

**Operational guidance**

- Choose Ceph RGW when the environment already has Ceph operational maturity and the platform wants
  to reuse that investment.
- Treat every advanced capability above as a rollout checklist item, not an assumption.
- Before enabling a workload that depends on versioning, retention, or event delivery, record the
  validated environment behavior in the deployment runbook.

**Internal SLA caveats**

- The common control-plane targets still apply to the supported baseline surface.
- Do not claim the same readiness for advanced features until the deployment-specific review is
  complete.
- A healthy baseline path with an unvalidated advanced path is still a conditional, not primary,
  support posture.

**Cost / operator-burden posture**

- Often attractive when the organization already operates Ceph and wants storage consolidation.
- Operational cost rises if the platform team must independently validate and maintain
  environment-specific behavior for advanced storage features.
- Net rollout cost can be low in an existing Ceph estate, but high for greenfield teams that do not
  already have Ceph expertise.

**Mandatory review triggers**

- New environment onboarding.
- Ceph RGW version upgrades.
- Changes to retention, bucket lifecycle, or event-integration configuration.
- Any release that depends on versioning, object lock, or event notifications as a hard requirement.

### 4.3 Garage (`garage`)

**Support posture**: Constrained / lightweight profile.

Garage satisfies the common baseline abstraction and the following advanced capabilities in the
current model:

- presigned URLs,
- multipart uploads,
- bucket policies.

The following advanced capabilities are **not assumed** in the common Garage profile:

- object versioning,
- bucket lifecycle,
- object lock,
- event notifications.

**Operational guidance**

- Choose Garage for smaller-footprint or edge-style environments that only need the baseline storage
  abstraction plus basic advanced flows like presigned URLs and multipart upload.
- Do not position Garage as equivalent to MinIO for feature-complete workloads.
- If a future story depends on versioning, retention controls, or storage eventing, treat Garage as
  a blocker unless the capability model and validation suite are explicitly extended.

**Internal SLA caveats**

- The common control-plane targets apply only to the supported baseline feature set.
- Unsupported advanced capabilities are out of SLA scope for this profile because they are not part
  of the assumed platform contract.

**Cost / operator-burden posture**

- Lowest complexity fit for deployments that prioritize footprint and baseline object storage
  semantics over advanced governance features.
- Lower infra cost can be outweighed quickly if downstream teams later need versioning, lifecycle,
  or event-driven integrations that the profile does not assume.
- Use this profile when the workload is intentionally constrained and that trade-off is explicit.

## 5. Capability-sensitive workload mapping

| Workload need | Preferred provider posture | Why |
| --- | --- | --- |
| Full feature-complete storage product surface | MinIO | All currently modeled advanced capabilities are satisfied |
| Existing Ceph estate with strong operator maturity | Ceph RGW | Reuses established platform investment, but requires explicit advanced-feature validation |
| Lightweight baseline object storage for smaller environments | Garage | Keeps footprint down if advanced storage governance features are not required |
| Strict dependence on versioning or object lock | MinIO first, Ceph RGW only after validation | Garage does not assume those features |
| Storage-driven event workflows | MinIO first, Ceph RGW only after integration validation | Garage does not assume event notifications |

## 6. Rollout and review checklist

Before enabling or switching a provider in a production-like environment, confirm:

1. the provider profile in the capability abstraction matches the deployment intent,
2. any deployment-dependent advanced capability has a recorded validation result,
3. the expected usage freshness window is observable,
4. credential rotation/revocation confirmation is part of the runbook,
5. support teams know whether the profile is primary, conditional, or constrained,
6. and the cost / operator-burden trade-off has been accepted by the owning team.

## 7. Maintenance rule

When a new storage provider is added or a current capability posture changes, update this document
in the same change set that modifies the provider capability model. The documentation is part of the
operable contract, not an afterthought.
