# Function Delete Lifecycle

Falcone function actions are deleted through the action-plane resource route:

```http
DELETE /v1/functions/actions/{resourceId}
Idempotency-Key: <unique-mutation-key>
```

The route returns `FunctionDeletionAccepted` (`202`) when deletion is accepted.
The `resourceId` is the action identifier returned by function inventory, list, or detail responses.

## Backend Teardown

The kind control-plane delete handler first resolves the action with the caller's tenant scope:

- deletion requires an allowed workspace write role and a verified claim for the addressed workspace;
- tenant owner/admin, platform operator, internal actor, and actor-type-only superadmin credentials do
  not bypass that check;
- missing or cross-tenant action IDs return `404 ACTION_NOT_FOUND` before any authorization detail can
  leak existence;
- same-tenant callers without a function write role receive `403 FORBIDDEN` before any Knative or
  database side effect.

When an owned action is accepted for deletion, the handler GET-verifies the labeled Knative Service,
captures its UID/resourceVersion, and requests a conditional delete. Kubernetes `404` is a clean
success; an ownership mismatch, replacement UID, conflict, or unavailable runtime fails closed.
Those cases return `202 cleanup_pending`, retain metadata, and create/reuse an owner-scoped durable
obligation for idempotent recovery. A pending response is not a claim that cluster cleanup finished.

After the service delete request succeeds, the store removes the action's durable rows:

| Table | Delete predicate |
| --- | --- |
| `fn_activations` | `resource_id` plus the resolved action's `workspace_id` |
| `fn_action_versions` | `resource_id` plus the resolved action's `tenant_id` |
| `fn_actions` | `resource_id` plus the resolved action's `tenant_id` |

The row predicates are derived from the already-resolved action row, never from request body scope.
That prevents a delete request for one tenant from removing another tenant's action history or
Knative service. Aggregate tenant/workspace teardown keeps the logical claim pending until all owned
Function and hosted-MCP resources are safe to reconcile; adjacent owners are preserved and retries
are idempotent. Hosted MCP uses the durable `falcone_mcp_state` snapshot. Create/publish is an exact
HTTP `202` accepted envelope, and invoke/delete first resolve the server against the path workspace
and verified owner before dependency/status disclosure. The Playground action is disabled when the
runtime is unavailable; cleanup emits central audit events queryable by correlation ID.

## Console Behavior

The web console exposes deletion from the selected function detail header. The control is disabled
while the selected function is in a non-actionable provisioning state. Before sending the DELETE, the
console uses the shared destructive confirmation dialog and requires the operator to type the exact
function name.

On success, the console clears the selected function detail, removes the row from the local inventory
view, displays a success message, and reloads inventory from the backend. On failure, the destructive
dialog stays open with the backend error, the selected row remains visible, and no success message is
shown.
