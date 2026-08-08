# Managed Knative installation — proposed integration contract

> Status: **proposed and unavailable for production use**. This page documents the Falcone-side
> integration tracked under issue `gntik-ai/falcone#933`; the companion chart bundle and lifecycle
> command were delivered in `gntik-ai/falcone-charts#8` (merged via PR #9). It is not an
> installation procedure and does not mean that Falcone currently installs or supports managed
> Knative. The existing Knative prerequisite remains authoritative until both repositories pass the
> coordinated acceptance described below.

As of 2026-08-08, `gntik-ai/falcone-charts#8` is merged (PR #9), the `falcone-knative` runtime
chart 0.1.0 is published, and the umbrella `in-falcone` chart/CLI contract is published as 0.4.1,
so the chart-side bundle and cluster-administrator lifecycle command exist. There is still no
authorized disposable remote OpenShift 4.21 or Kubernetes 1.34
cluster-admin target on which the required managed acceptance has run. Consequently, the
application-side and chart-side contracts described here are source-level behavior, not release,
deployment, or support availability; live managed acceptance remains blocked and managed mode stays
unavailable.

## Audience and outcome

This proposal is for P18 platform installers, P3 platform operators/SREs, P10 read-only auditors,
and P17 documentation-only evaluators. It fixes the application/chart boundary before the
cluster-scoped lifecycle executor is released:

- the installer selects exactly one `managed`, `external`, or `disabled` mode;
- the Falcone control plane consumes a read-only, chart-owned status record;
- platform operators and auditors can inspect sanitized status without gaining mutation rights;
- Functions fail before a Kubernetes write when the selected runtime cannot serve workloads; and
- deletion during an outage becomes durable `deletion_pending` work rather than false success.

Tenant/workspace users cannot select a mode, claim ownership, or mutate Knative cluster resources.

## Current support boundary

The proposed managed bundle is patched upstream Knative Serving and Kourier 1.22.1 for Kubernetes
1.34 and OpenShift 4.21 `restricted-v2`. It is a Falcone-supported bundle only after coordinated
acceptance. It is **not** the Red Hat-supported OpenShift Serverless Operator product path.

The companion chart owns the future cluster-administrator lifecycle command, separate
`falcone-knative` release, provenance lock, digest-only images, CRDs, cluster RBAC, webhooks,
Serving controllers, Kourier, compatibility/ownership preflight, upgrades, rollback, uninstall,
and handoff. This repository does not install or reconcile those resources.

Version 0.4.1 does **not** yet provision the per-tenant runtime namespace mapping, namespaced RBAC,
or hosted-MCP `NetworkPolicy` permissions consumed by the application-side contract. In source,
the executor requires an authoritative tenant-to-namespace resolver and rejects an unmapped tenant;
tenant identifiers are never treated as Kubernetes namespace names. Publishing 0.4.1 therefore
does not satisfy the application/chart acceptance gate and must not be represented as a working
managed deployment procedure.

## Proposed modes

| Mode | Intended owner | Falcone behavior before chart acceptance |
|---|---|---|
| `managed` | one exclusive Falcone managed release | Reads chart status only. Missing, malformed, unsupported, or non-ready status closes workload gates. |
| `external` | an administrator-supplied external installation | Reads discovery/compatibility and a pre-existing canary result only. Falcone creates no validation resource. |
| `disabled` | none | Installs non-Knative capabilities and reports the runtime disabled. Knative-dependent work cannot start. |

`managed` must never become an unconditional dependency of the Falcone umbrella release. An
existing installation must explicitly choose `external`, `disabled`, or a reviewed migration;
Falcone must not silently adopt an Operator-owned or otherwise unknown installation.

## Application configuration contract

The control plane accepts these settings:

```dotenv
KNATIVE_RUNTIME_MODE=disabled
KNATIVE_RUNTIME_STATUS_FILE=/var/run/falcone/knative/status.json
FUNCTIONS_ENABLED=true
# Proposed source contract only; chart 0.4.1 does not render these values.
MCP_RUNTIME_NAMESPACE_MAP={"tenant-id":"tenant-runtime-namespace"}
MCP_RUNTIME_PLATFORM_NAMESPACES=falcone
MCP_RUNTIME_INGRESS_NAMESPACES=knative-serving,kourier-system,falcone
MCP_RUNTIME_EGRESS_NAMESPACES=falcone
MCP_RUNTIME_DNS_NAMESPACES=kube-system,openshift-dns
```

`KNATIVE_RUNTIME_MODE` accepts exactly `managed`, `external`, or `disabled`. An unset mode defaults
to `disabled` so this proposed integration cannot advertise itself as ready before chart wiring and
acceptance. Any other value is a startup configuration error. `KNATIVE_RUNTIME_STATUS_FILE` must be
an absolute path. `FUNCTIONS_ENABLED` accepts only `true`, `false`, `1`, or `0`; when false, the
existing `501 FUNCTIONS_DISABLED` behavior takes precedence over runtime availability.

`MCP_RUNTIME_NAMESPACE_MAP` is a JSON object whose keys are application tenant identifiers and
whose values are validated Kubernetes DNS-label namespaces. There is no identity fallback.
Apply, internal invocation, and cleanup consult the same resolver. The ingress allow-list must name
the platform and Knative data-path namespaces; egress is limited to DNS on port 53 plus the named
platform destinations. Invalid or missing mappings and namespace entries fail closed before a
Kubernetes write. These variables describe application source behavior only: chart 0.4.1 does not
create the mapped namespaces, bind the executor service account there, or configure these values.

For `managed` and `external`, the chart mounts an atomically replaced, non-secret JSON file. Falcone
does not accept runtime status from a tenant request, and it does not write this file. The v1 input
shape is:

```json
{
  "schemaVersion": "falcone.knative-runtime/v1",
  "mode": "external",
  "owner": "red-hat-openshift-serverless",
  "version": "1.22.1",
  "compatibility": "compatible",
  "readiness": {
    "state": "ready",
    "stage": "external_validation",
    "reason": "READY",
    "lastTransitionAt": "2026-08-07T10:00:00.000Z"
  },
  "externalCanary": {
    "state": "verified"
  }
}
```

The reason is a bounded stable code, not a raw exception. The file must not contain credentials,
tokens, source code, endpoints, logs, tenant workload names, or administrator-supplied free text.
The control plane reads at most 16 KiB and exposes only the sanitized fields documented in
[the runtime status reference](../reference/architecture/knative-runtime-status.md).

External mode reaches `ready` only when compatibility is `compatible`, version 1.22.1 is reported,
and a chart-side read/invoke check of an administrator-supplied pre-existing canary reports
`verified`. `missing`, `unreadable`, or `invoke_failed` remains `unverified`. Falcone never creates,
patches, relabels, upgrades, or deletes that canary or any external cluster resource.

## Proposed acceptance gate

Do not publish managed mode as available until both repository versions are pinned together and
independent acceptance proves all of the following:

1. a disposable clean Kubernetes 1.34 installation and a remote OpenShift 4.21 installation with
   cluster-admin authority;
2. collision rejection against Operator, raw, unknown, partial, and other-Falcone ownership before
   any mutation;
3. digest-only Harbor mirror rendering with no public registry request;
4. OpenShift `restricted-v2` admission and actual pod startup without fixed Kourier UID/GID, a
   custom SCC, privilege escalation, or extra capabilities;
5. staged CRD, webhook, Serving, Kourier, and smoke-service readiness;
6. Function and hosted MCP create/invoke/version/rollback/delete, scale-to-zero, tenant isolation,
   outage/recovery, preconditioned owner-safe cleanup with verified absence, and teardown journeys;
7. one-minor upgrade, compatible rollback, forward-repair boundary, retain-by-default uninstall,
   explicit purge, and owner-safe handoff; and
8. independent contract, authorization, tenant-isolation, accessibility, documentation, deployment,
   and cleanup review.

The available `cingusoft-dev` environment may provide read-only `external` evidence only. It is not
a clean-install substitute because Knative is already present and the available identity lacks the
required cluster-scoped authority.

## Rollback of this proposed application integration

Before coordinated release, leave `KNATIVE_RUNTIME_MODE=disabled` (or do not set it), remove the
status-file mount, and continue using the currently documented external prerequisite. This changes
only Falcone application gates; it does not remove CRDs, Knative workloads, or external ownership.
Never delete cluster-scoped Knative resources as an application rollback.
