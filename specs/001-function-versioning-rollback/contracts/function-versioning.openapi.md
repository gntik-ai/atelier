# Contract Draft: Function Versioning and Rollback

## Purpose

Describe the planned public contract additions for `US-FN-03-T01` before implementation updates the OpenAPI family and helper modules.

## Proposed route additions

### 1. List versions for one function action

- **Method**: `GET`
- **Path**: `/v1/functions/actions/{resourceId}/versions`
- **Audience**: same read audience as `getFunctions`
- **Response**: `200 OK`
- **Body**: `FunctionVersionCollection`

### 2. Get one function version

- **Method**: `GET`
- **Path**: `/v1/functions/actions/{resourceId}/versions/{versionId}`
- **Audience**: same read audience as `getFunctions`
- **Response**: `200 OK`
- **Body**: `FunctionVersion`

### 3. Request rollback to a prior version

- **Method**: `POST`
- **Path**: `/v1/functions/actions/{resourceId}/rollback`
- **Audience**: same mutation audience as `updateFunctions` or stricter
- **Headers**: `X-API-Version`, `X-Correlation-Id`, `Idempotency-Key`
- **Request body**: `FunctionRollbackWriteRequest`
- **Response**: `202 Accepted`
- **Body**: `FunctionRollbackAccepted`

## Proposed schema additions

### `FunctionAction` additions

- `activeVersionId`
- `versionCount`
- `rollbackAvailable`
- `latestRollbackAt` (optional)

### `FunctionVersion`

- `versionId`
- `resourceId`
- `tenantId`
- `workspaceId`
- `versionNumber`
- `status`
- `rollbackEligible`
- `originType`
- `originVersionId` (optional)
- `source`
- `execution`
- `activationPolicy`
- `deploymentDigest`
- `timestamps`

### `FunctionVersionCollection`

- `items[]` of `FunctionVersion`
- `page`

### `FunctionRollbackWriteRequest`

- `versionId`
- `reason` (optional, operator-facing)

### `FunctionRollbackAccepted`

- `resourceId`
- `requestedVersionId`
- `status` (`accepted` | `queued`)
- `acceptedAt`
- `requestId`
- `correlationId`

## Error expectations

Rollback should explicitly reject these cases with governed error responses:

- target version not found
- target version outside caller scope
- target version already active
- target version not rollback-eligible
- caller lacks mutation permission
- rollback conflicts with another active lifecycle mutation

## Compatibility notes

- Existing action create/get/update/delete routes remain the primary logical function surface.
- Versioning is modeled as a nested lifecycle subresource under the function action.
- Rollback remains asynchronous to align with current accepted mutation patterns in the control-plane API.
