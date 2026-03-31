# Data model — 099-plan-management-api-console

## Core entities

### Plan

- `id`: stable plan identifier
- `slug`: unique human-readable key
- `displayName`: console label
- `description`: optional summary
- `status`: `draft | active | deprecated | archived`
- `capabilities`: map of capability key → boolean
- `quotaDimensions`: map of dimension key → integer (`-1` unlimited, absent inherits default)
- `createdAt`, `updatedAt`, `createdBy`, `updatedBy`

### PlanAssignment

- `assignmentId`
- `tenantId`
- `planId`
- `effectiveFrom`
- `supersededAt`
- `assignedBy`
- `assignmentMetadata`

### QuotaDimensionCatalogEntry

- `dimensionKey`
- `displayLabel`
- `unit`
- `defaultValue`
- `description`

## API envelopes

### Paginated list

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "pageSize": 20
}
```

### Error envelope

```json
{
  "error": {
    "code": "PLAN_NOT_FOUND",
    "message": "No plan found.",
    "detail": {}
  }
}
```

## Console view models

### PlanCatalogRow

- `id`
- `slug`
- `displayName`
- `status`
- `assignedTenantCount`
- `updatedAt`

### LimitProfileRow

- `dimensionKey`
- `displayLabel`
- `unit`
- `defaultValue`
- `effectiveValue`
- `explicitValue`
- `source`: `default | explicit | unlimited`

### TenantPlanOverviewModel

- `assignment`
- `plan`
- `limits.profile[]`
