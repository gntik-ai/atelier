# Console audit export feedback

The Observability Audit tab uses the existing metrics audit-export routes:

```text
POST /v1/metrics/tenants/{tenantId}/audit-exports
POST /v1/metrics/workspaces/{workspaceId}/audit-exports
```

The console submits an explicit JSON Lines request (`format: "jsonl"`) with `pageSize: 500` and
`maskingProfileId: "default_masked"`.
The request body may include the same audit filters used by the list/query surface. The route and
caller identity determine the tenant/workspace scope; a body value cannot broaden that scope.
Existing authorization checks are unchanged; this describes callers already authorized for the
corresponding scope.

The request body requires `format` and accepts only `jsonl` or `csv`. `pageSize` is optional: when
omitted it is `500`; when supplied it must be an integer from `1` through `10000`. Invalid format,
limit, sort, filter, time window, or masking-profile input is rejected with a coded 4xx response
before the audit store is queried.

An operational store or export-builder failure is a coded 5xx response. It is never converted into
an empty success; the inline fallback is reserved for an unavailable builder.

Those routes are already defined by the public metrics contract as audit export preview routes. When
the backend produces an export, the response is an `AuditExportManifest` with an `exportId`,
`itemCount`, `maskedItemCount`, and `items`. The console must treat that response as the source of
truth rather than treating any 2xx status as success.

## Console states

- **Completed/produced manifest**: if the response includes a manifest artifact (`exportId`,
  numeric `itemCount`, and an `items` array), the Audit tab shows the export id, exported record
  count, masked-record count, backend status, and a `Descargar JSON` button. The download is the
  manifest returned by the API, serialized as JSON in the browser; it does not require an additional
  backend route.
- **Acknowledged or pending without artifact**: if the response is accepted/pending or otherwise
  lacks an artifact, the Audit tab shows an unavailable/pending information state. It uses the
  backend `message` when present and does not show the previous generic success copy or a download
  button.
- **Failure**: if the POST fails, the Audit tab shows an explicit export error and does not render
  success feedback or download controls.

The response is an inline manifest only. It is not a durable export artifact and no separate
download route or persisted export file is created. The browser may serialize the returned manifest
for the local `Descargar JSON` action; this does not create a server-side artifact.

## Contract note

This behavior does not add routes or response fields. It aligns the web console with the existing
`AuditExportManifest` response schema in the metrics OpenAPI family, records the request's existing
`pageSize` default of `500`, and keeps no-artifact acknowledgements visually distinct from completed
exports.
