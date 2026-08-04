# Observability Audit Record Queries

The same read-only query contract applies to both audit-record list routes:

- `GET /v1/metrics/tenants/{tenantId}/audit-records`
- `GET /v1/metrics/workspaces/{workspaceId}/audit-records`

The path remains the source of scope. Every request, including a continuation, authenticates and
authorizes that path and then binds its datastore read to the resolved tenant. A workspace request
also binds the read to that exact workspace. Filters and cursors can only narrow or continue this
authorized read; they cannot supply, widen, authenticate, or authorize a scope. The GET does not
write audit rows, persist cursors, change quota state, create an export, or change permissions.

## Exact filters

All supplied filters are exact, case-sensitive predicates combined with `AND`. Text is sent as a
database-driver parameter and is never interpreted as a SQL fragment, wildcard, regular
expression, prefix, or partial match.

| Public parameter | Response field | Type or allowed values |
| --- | --- | --- |
| `filter[occurredAfter]` | `eventTimestamp` | Inclusive RFC 3339 lower bound |
| `filter[occurredBefore]` | `eventTimestamp` | Inclusive RFC 3339 upper bound |
| `filter[subsystem]` | `resource.subsystemId` | `iam`, `postgresql`, `mongodb`, `kafka`, `openwhisk`, `storage`, `quota_metering`, `tenant_control_plane`, `mcp` |
| `filter[actionCategory]` | `action.category` | `resource_creation`, `resource_deletion`, `configuration_change`, `access_control_modification`, `quota_adjustment`, `privilege_escalation`, `secret_rotation`, `policy_override`, `backup_restore`, `provider_reconciliation` |
| `filter[actionId]` | `action.actionId` | Exact string |
| `filter[outcome]` | `result.outcome` | `succeeded`, `failed`, `denied`, `partial`, `accepted` |
| `filter[actorType]` | `actor.actorType` | `platform_user`, `tenant_user`, `workspace_user`, `service_account`, `system`, `provider_adapter` |
| `filter[actorId]` | `actor.actorId` | Exact string |
| `filter[resourceType]` | `resource.resourceType` | Exact string |
| `filter[resourceId]` | `resource.resourceId` | Exact string |
| `filter[originSurface]` | `origin.originSurface` | `control_api`, `console_backend`, `internal_reconciler`, `provider_adapter`, `bootstrap_job`, `scheduled_operation` |
| `filter[correlationId]` | `correlationId` | Exact string |

A syntactically valid free-form filter that matches no row returns HTTP `200` with `items: []`,
`page.size: 0`, `page.hasMore: false`, no `page.nextCursor`, and the effective snake-case filter in
`appliedFilters`. It never falls back to the unfiltered record set.

Malformed input returns HTTP `400` before the audit datastore is queried. In particular:

- every supported query control must appear at most once; repeated page, sort, cursor, or filter
  parameters are ambiguous and are rejected;
- a filter that is present must have a non-empty value; an empty timestamp, enum, or free-form
  filter is rejected rather than being treated as if the filter were omitted;
- `page[size]` must be one base-10 integer from 1 through 200; omission means 25;
- `sort` must be `eventTimestamp` or `-eventTimestamp`; omission means `-eventTimestamp`;
- each time bound must be a complete, valid RFC 3339 date-time, and the lower bound must not be
  later than the upper bound, including when the values differ below millisecond precision;
- each enum must be one of the values in the table; and
- `page[after]` must be a structurally valid, compatible version-1 cursor.

## Total ordering and continuation

`sort=eventTimestamp` orders by `created_at ASC, id ASC`.
`sort=-eventTimestamp` orders by `created_at DESC, id DESC`. The event ID is the stable tie-breaker
when timestamps are equal, so a static result set can be traversed without duplicates or gaps.

The datastore selects `page[size] + 1` rows. The response returns at most the requested number,
sets `page.size` to the number actually returned, and sets `page.hasMore` only when the lookahead row
exists. `page.nextCursor` is emitted from the last returned row only when `hasMore` is true; it is
omitted on an exact, partial, or empty terminal page.

The cursor is unpadded base64url JSON version 1. It contains the last `(created_at, id)` position
and a SHA-256 fingerprint of the authorized tenant/workspace route scope, canonical effective
filters, and sort. Page size is deliberately outside the fingerprint, so a continuation may use a
different valid size. Changing scope, any filter, or sort makes the cursor incompatible and returns
HTTP `400` before the audit query. A cursor is opaque continuation state, not a credential,
authentication token, permission, or authorization boundary.

The timestamp position is emitted directly from PostgreSQL in UTC with microsecond precision; it is
not round-tripped through the millisecond-only JavaScript `Date` representation. The ID position is
validated as the canonical UUID used by `plan_audit_events` before it can become a tuple parameter.
Legacy stored action-category and correlation values are normalized with the same expressions for
projection and filtering, so a client can filter by exactly the value it previously received.

Example first page and continuation:

```http
GET /v1/metrics/tenants/{tenantId}/audit-records?page[size]=50&sort=-eventTimestamp&filter[outcome]=failed&filter[actorId]=user-123

GET /v1/metrics/tenants/{tenantId}/audit-records?page[size]=25&sort=-eventTimestamp&filter[outcome]=failed&filter[actorId]=user-123&page[after]={nextCursor}
```

Both requests remain tenant-scoped and return only failed records for `user-123`. The second may
change the page size because every membership-defining query field is unchanged.

## Web console behavior

The audit page retains its five Actor, Category, Result, From, and To controls. A named, keyboard-
focusable **Cargar más** button appears only when the server supplies both `hasMore: true` and a
non-empty `nextCursor`. While continuation is pending the button is disabled and exposes its busy
state. Accepted rows append in server order, duplicate event IDs are suppressed defensively, and a
live status reports the appended and total counts.

Changing tenant/workspace context or any of the five controls, or explicitly reloading, clears the
accumulated page state and starts at the first page. Late responses from the previous query are
discarded. If continuation fails, already loaded records and the unadvanced cursor remain visible,
an accessible error is shown, and the same continuation can be retried. The button disappears on a
terminal page.
