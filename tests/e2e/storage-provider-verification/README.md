# Storage Provider Verification Matrix

This directory defines the minimum multi-provider verification scenarios that future live-provider automation must execute when changing the storage abstraction, provider roster, tenant-context lifecycle, or normalized error taxonomy.

## Scope

The matrix covers at least one primary S3-compatible provider and one alternate provider:

- `minio`
- `garage`
- `ceph-rgw` (optional alternate when available)

## Section 1 — Functional Equivalence Scenarios (FR-002)

| Scenario ID | Operation | Provider | Expected Outcome | Evidence Required |
|---|---|---|---|---|
| STO-VER-001 | `bucket.create` | each provider | bucket creation accepted and write-eligible | verification report scenario result + provider verdict |
| STO-VER-002 | `bucket.delete` | each provider | empty verification bucket can be deleted | deletion scenario result + cleanup summary |
| STO-VER-003 | `bucket.list` | each provider | only scoped verification buckets are listed | collection snapshot + scenario result |
| STO-VER-004 | `object.put` | each provider | object upload accepted with metadata preserved | upload preview/assertion + scenario result |
| STO-VER-005 | `object.get` | each provider | object download returns payload and metadata | download preview/assertion + scenario result |
| STO-VER-006 | `object.delete` | each provider | object deletion preview accepted | deletion preview/assertion + scenario result |
| STO-VER-007 | `object.list` | each provider | object listing returns every verification object once | object collection evidence + scenario result |
| STO-VER-008 | `object.metadata.get` | each provider | metadata contains content type and ETag/checksum | metadata snapshot + scenario result |
| STO-VER-009 | `object.conditional.if_match` | each provider | matching precondition accepted | conditional assertion + scenario result |
| STO-VER-010 | `object.conditional.if_none_match` | each provider | conflicting precondition normalizes to `STORAGE_PRECONDITION_FAILED` | normalized envelope + scenario result |
| STO-VER-011 | `object.list.pagination` | each provider | opaque continuation token and stable follow-up page | page 1/page 2 evidence + scenario result |
| STO-VER-012 | `object.content_type.preserve` | each provider | upload/download preserve content type | object metadata + payload headers |
| STO-VER-013 | `object.integrity.etag_or_checksum` | each provider | upload response includes ETag or checksum | object metadata + scenario result |

### Evidence expectations — functional equivalence

A functional scenario passes only when the verification report records:

- `scenarioId`
- `providerType`
- `operation`
- `status: passed`
- the expected comparison assertion in the scenario summary or assertion message

## Section 2 — Error Taxonomy Consistency Scenarios (FR-003)

| Error Code | Trigger Condition | Expected Normalized Code | Expected HTTP Status | Expected Retryability | Consistency Verdict |
|---|---|---|---|---|---|
| `error.object_not_found` | missing object lookup | `OBJECT_NOT_FOUND` | `404` | `not_retryable` | all providers identical |
| `error.bucket_not_found` | missing bucket lookup | `BUCKET_NOT_FOUND` | `404` | `not_retryable` | all providers identical |
| `error.bucket_already_exists` | duplicate bucket creation | `BUCKET_ALREADY_EXISTS` | `409` | `not_retryable` | all providers identical |
| `error.access_denied` | forbidden object or bucket access | `STORAGE_ACCESS_DENIED` | `403` | `not_retryable` | all providers identical |
| `error.invalid_request` | invalid bucket or object request | `STORAGE_INVALID_REQUEST` | `400` | `not_retryable` | all providers identical |

### Evidence expectations — error taxonomy

A taxonomy scenario passes only when the verification report captures:

- `normalizedCode`
- `httpStatus`
- `retryability`
- one provider result per tested provider
- `consistent: true`

## Section 3 — Capability Baseline Validation Scenarios (FR-004)

| Provider | Eligible | Required Capabilities Satisfied | Missing Capabilities | Evidence Required |
|---|---|---|---|---|
| `minio` | yes | all required baseline capabilities | none | baseline verification result + provider profile snapshot |
| `garage` | yes | all required baseline capabilities | none | baseline verification result + provider profile snapshot |
| negative fixture | no | incomplete by design | explicit missing capability IDs | baseline verification result + failure detail |

### Evidence expectations — capability baseline

A baseline scenario passes only when the report includes:

- `providerType`
- `eligible`
- `satisfiedCapabilities`
- `missingCapabilities`
- `insufficientCapabilities`

## Section 4 — Multi-Tenant Isolation Scenarios (FR-005/FR-006)

| Scenario | Provider | Tenant A | Tenant B | Expected Denial Code | Listing Exclusion Verified |
|---|---|---|---|---|---|
| `isolation.cross_tenant_bucket_access` | each provider | anonymized verification tenant | anonymized verification tenant | `STORAGE_ACCESS_DENIED` | n/a |
| `isolation.listing_exclusion` | each provider | anonymized verification tenant | anonymized verification tenant | n/a | yes |

### Evidence expectations — tenant isolation

An isolation scenario passes only when the report records:

- anonymized tenant references (`tctx-*`)
- `scenario`
- `providerType`
- `passed: true`
- `denialErrorCode: STORAGE_ACCESS_DENIED` for access-denial cases

## Section 5 — Operational Hygiene and Boundary Scenarios (FR-010 to FR-014)

| Scenario | Trigger | Expected Outcome | Cleanup Evidence |
|---|---|---|---|
| idempotency / cleanup | rerun verification on same provider set | rerun succeeds without orphan resources | cleanup summary + no leaked buckets/objects |
| `boundary.large_object_upload` | upload near common regression boundary | upload accepted consistently across providers | scenario result + boundary-size assertion |
| `boundary.pagination_multi_page` | list enough objects to force multiple pages | all objects returned once across pages | page evidence + no duplication assertion |

### Evidence expectations — hygiene and boundaries

Operational hygiene scenarios pass only when the report contains:

- explicit scenario result(s)
- cleanup confirmation or absence of orphaned resources
- boundary assertion messages for large-object and multi-page pagination coverage

## Review triggers

Re-review this matrix when any of the following changes occur:

- a new storage provider is added or promoted to supported status
- any storage FR in `US-STO-01-T06` changes
- the normalized error taxonomy changes
- the minimum capability baseline changes
- tenant isolation rules or storage-context activation rules change
