# Workspace identity claim — rollout and back-fill runbook

Operator runbook for the #961 fix (`fix(iam): mint the workspace_id claim in tenant realms`).

Tenant realms were provisioned without the Keycloak 26 user-profile declarations for `tenant_id` /
`workspace_id`, and with `tenant-context` / `workspace-context` client scopes that carried no
protocol mappers. Keycloak therefore discarded the attributes the platform stamped, and no principal
in a tenant realm ever received a `workspace_id` claim.

The code fix repairs **provisioning**. It does not repair anything that already exists, so a deploy
alone changes nothing observable. Read the whole of §1 before starting.

## 1. What "deployed" means here — three steps, not one

| Step | Reaches | Without it |
| --- | --- | --- |
| Publish + roll the `in-falcone-control-plane` image | Realms provisioned **after** the roll | Every new tenant keeps the defect |
| Run the back-fill | Realm **configuration** of existing realms | Existing realms stay claim-less forever |
| Re-stamp existing users | Attribute **values** on existing principals | Existing users keep `workspace_id: null` even in a repaired realm |

The third step is the one most easily missed. Declaring an attribute cannot invent a value that
Keycloak discarded at create time — this was confirmed against a real Keycloak 26: a retrofitted
realm mints the claim for a *newly created* principal while the pre-existing user still returns
`null`. The back-fill reports that population as `usersWithoutStoredWorkspaceId`.

## 2. Pre-flight — read the state before changing it

This deployment has known drift. Confirm all four before an announced window is agreed.

```bash
kubectl config current-context                 # MUST be the expected default context
echo "$FALCONE_NS"                             # MUST be the Falcone namespace, and only that

# (a) Does the running pod match what the chart pins? At the time of writing it did NOT:
#     running sha256:0c6aeff8...  vs  Helm-pinned sha256:27aedb...
kubectl -n "$FALCONE_NS" get deploy falcone-control-plane \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
helm get values falcone -n "$FALCONE_NS" | grep -A3 'in-falcone-control-plane'

# (b) Do the last upgrades tell a happy story? At the time of writing revisions 17 and 18 FAILED
#     on pre-upgrade hooks (eso-preflight, then falcone-temporal-schema).
helm history falcone -n "$FALCONE_NS"

# (c) How far behind is the deployment? Staging ran 0.3.1 against a v0.6.4 release line.
helm list -n "$FALCONE_NS"
```

**A `helm upgrade` reverts any out-of-band `kubectl patch` or `kubectl set image` another track is
relying on.** If (a) shows drift, find its owner before upgrading — the drift is someone's working
state, not noise. Two Deployments (`falcone-control-plane-executor`, `falcone-workflow-worker`) are
also known to carry a hand-set `runAsUser: 1000` masking #965.

## 3. Publish the image

Images are built by `.github/workflows/release-images.yml`, which runs on a published GitHub Release
or on `workflow_dispatch` with an explicit version. Use the workflow — do not build and push by hand
from a workstation. Hand-built images are how this deployment stopped being reproducible from the
charts repo.

```bash
gh workflow run release-images.yml -f tag=<VERSION>      # e.g. 0.3.2
gh run watch "$(gh run list --workflow=release-images.yml --limit 1 --json databaseId \
  --jq '.[0].databaseId')"
```

Only `in-falcone-control-plane` carries this fix. The other images in the matrix are unchanged by it.

## 4. Roll the control plane

The chart lives in `falcone-charts`; this repo does not edit it. Pin the new version through the
release values that already exist, in an announced window.

```bash
helm upgrade falcone <chart> -n "$FALCONE_NS" --reuse-values \
  --set controlPlane.image.tag=<VERSION> --set controlPlane.image.digest=<DIGEST> \
  --atomic --timeout 10m
```

`--atomic` matters here specifically because of §2(b): the pre-upgrade hooks on this release have
failed twice, and without it a hook failure leaves the release wedged rather than rolled back.

Verify the roll before continuing:

```bash
kubectl -n "$FALCONE_NS" rollout status deploy/falcone-control-plane --timeout=5m
kubectl -n "$FALCONE_NS" get deploy falcone-control-plane \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

### Confirm the fix is live before touching existing realms

Provision one throwaway tenant, then decode a token for a principal in it. The claim must be
present. Purge the tenant afterwards.

```text
POST /v1/tenants                       -> 201
POST /v1/auth/signups {tenantId, workspaceId}
ROPC against the tenant realm          -> access token
decode payload                         -> workspace_id == the provisioned workspace
```

If the claim is absent here, stop. The back-fill cannot help, because provisioning itself is still
wrong.

## 5. Back-fill existing realms

`scripts/backfill-tenant-realm-identity-claims.mjs` re-applies the two idempotent helpers
(`relaxUserProfile`, `applyRequiredClientScopes`) to every active tenant realm. It is **dry-run by
default**; `--apply` writes.

This mutates Keycloak realm configuration for every tenant, so it belongs in an announced window
(CLAUDE.md rule 4) and is human-review gated (rule 7).

```bash
export KEYCLOAK_BASE_URL=... KEYCLOAK_ADMIN_USERNAME=... KEYCLOAK_ADMIN_PASSWORD=...
export PROVISIONING_DB_URL=...

node scripts/backfill-tenant-realm-identity-claims.mjs            # dry run — reads only
node scripts/backfill-tenant-realm-identity-claims.mjs --apply
```

Handle the admin credentials as credentials: prefer an in-cluster job or a shell that does not
persist history, never write them to a file in a scratch directory, and shred anything that does end
up on disk. This campaign has already had one incident of tokens left behind by agents that died
mid-run.

Read the dry-run report first. Per realm it prints `missingAttributes` and `missingMappers`; a realm
listing neither needs no work. The run is safe to repeat — the profile PUT is skipped when nothing
changed, and the mapper POST is skipped when a mapper of that name is present, so a second `--apply`
is a clean no-op.

## 6. Re-stamp existing principals

The back-fill's `usersWithoutStoredWorkspaceId` is the remaining work: principals created while the
attributes were undeclared hold no stored `workspace_id`, and no realm-level change can supply one.

Each needs its binding written through the admin path, which requires deciding **which** workspace
each principal belongs to — the platform did not record it anywhere else, so this is not mechanical.
Options, in order of preference:

1. Derive the binding from an authoritative source (an invitation record, a workspace membership
   list, the tenant's own provisioning request) and write it per user.
2. Re-create the principal through the normal signup path, which now stamps a validated binding.
3. Leave tenant-level principals alone: they legitimately have no `workspace_id`, and the absence is
   correct rather than a gap to fill.

Do not bulk-assign a default workspace. `workspace_id` is what workspace-scoped authorization binds
to, so a guessed binding is a granted authorization.

## 7. Verify

```text
GET  {kc}/admin/realms/{realm}/users/profile
  -> declaredAttributes includes tenant_id and workspace_id
  -> both carry permissions.edit == ["admin"]        (never "user")

GET  {kc}/admin/realms/{realm}/client-scopes
  -> workspace-context has a workspace_id oidc-usermodel-attribute-mapper
  -> tenant-context has NO usermodel mapper           (deliberate — see below)

ROPC against the tenant realm, decode the access token
  -> workspace_id present for a workspace-bound principal
  -> tenant_id still equals the realm name
```

`tenant-context` carrying no user-attribute mapper is intentional and must stay that way. A tenant
realm's name *is* the tenant id, and `createTenant` stamps it with a hardcoded, un-forgeable client
mapper. A second user-attribute-sourced mapper for the same claim would make the emitted value
undefined. `bbx-wsid-04` fails if one is ever added.

## 8. Rollback

| Step | Reverse |
| --- | --- |
| Image roll | `helm rollback falcone <previous-revision> -n "$FALCONE_NS"` |
| Back-fill | Not automatically reversible, and normally should not be reversed |
| User re-stamp | Remove the attribute from the affected users through the admin API |

The back-fill is additive: it declares two attributes and adds one protocol mapper. Reverting it
would re-break claim minting rather than restore a good state. If a rollback of the *image* is
needed, the back-filled realm configuration is harmless to leave in place — the pre-fix code neither
reads nor removes it.

## 9. What this rollout does not fix

- **Fail-open workspace checks.** The executor's path↔credential binding check, the gateway's
  `WORKSPACE_SCOPE_MISMATCH` denial and the console's workspace filter are all skipped when the claim
  is absent. A workspace-bound principal now carries it, so those checks bind for that population —
  but a tenant-level principal legitimately has no claim, so closing them properly requires workspace
  *membership*. That is #973, and this rollout does not discharge it.
- **The unscoped `getWorkspace`.** `getWorkspaceInTenant` was added for the signup binding only; the
  unscoped lookup and its other callers still resolve `id = $1 OR slug = $1` with no tenant predicate
  and no ordering.
- **Workspace `status`.** Neither lookup consults it, so an archived workspace still yields a binding.
