# Data Model: Function Versioning and Rollback

## Overview

This task extends the governed OpenWhisk function administration model with lifecycle metadata for immutable function versions and controlled rollback. It does not require final persistence technology decisions in this planning artifact, but it defines the entities and state transitions the implementation must preserve.

## Entities

### 1. FunctionActionLifecycle

**Purpose**: Represents the logical managed function that users recognize in the workspace.

**Key attributes**
- `resource_id`
- `tenant_id`
- `workspace_id`
- `action_name`
- `active_version_id`
- `version_count`
- `latest_publish_at`
- `latest_rollback_at`
- `rollback_available`
- `status`

**Notes**
- This extends the existing governed function action view with lifecycle state.
- There is exactly one active version per logical function action.

### 2. FunctionVersion

**Purpose**: Immutable record of one deployable function revision.

**Key attributes**
- `version_id`
- `resource_id`
- `version_number` or monotonic display sequence
- `source_snapshot`
- `execution_snapshot`
- `activation_policy_snapshot`
- `deployment_digest`
- `created_at`
- `created_by`
- `origin_type` (`publish` | `rollback_restore`)
- `origin_version_id` (optional)
- `status` (`active`, `historical`, `rollback_target`, `retired`, `invalid`)
- `rollback_eligible`

**Notes**
- The version record must be immutable after creation.
- Rollback restores should preserve the source version relationship for operator clarity.

### 3. FunctionVersionTimelineEntry

**Purpose**: Product-facing lifecycle event for the function version history.

**Key attributes**
- `timeline_entry_id`
- `resource_id`
- `version_id`
- `event_type` (`published`, `promoted_active`, `rolled_back_from`, `rolled_back_to`, `marked_invalid`)
- `recorded_at`
- `actor_id`
- `actor_type`
- `summary`
- `reason`

**Notes**
- Timeline entries let the console and API explain what happened without mutating the immutable version record itself.

### 4. RollbackRequest

**Purpose**: Represents a governed restore action initiated by an authorized operator.

**Key attributes**
- `rollback_request_id`
- `resource_id`
- `requested_version_id`
- `requested_at`
- `requested_by`
- `idempotency_key`
- `status` (`accepted`, `rejected`, `completed`, `failed`)
- `rejection_reason`
- `resulting_active_version_id`

**Notes**
- This aligns rollback with the existing accepted mutation pattern used by the control plane.

## Relationships

- One `FunctionActionLifecycle` has many `FunctionVersion` records.
- One `FunctionActionLifecycle` has exactly one `active_version_id` at any time.
- One `FunctionVersion` can produce many `FunctionVersionTimelineEntry` records over its lifetime.
- One `RollbackRequest` targets one prior `FunctionVersion` and may result in one newly active lifecycle state.

## State Transitions

### Publish flow

1. Existing logical function action is updated.
2. A new immutable `FunctionVersion` is created.
3. `FunctionActionLifecycle.active_version_id` moves to the new version.
4. Timeline records `published` and `promoted_active`.

### Rollback flow

1. Operator selects an eligible prior `FunctionVersion`.
2. Product validates scope, permissions, and target eligibility.
3. Rollback request is accepted.
4. Selected prior version becomes active for future executions.
5. Timeline records the rollback event and preserves prior/new active relationships.

### Rejected rollback flow

1. Operator targets a non-existent, ineligible, or already-active version.
2. Product records a rejected rollback outcome.
3. Active version remains unchanged.

## Validation Rules

- `version_id` must be unique within the product.
- `resource_id`, `tenant_id`, and `workspace_id` must remain consistent across the logical action and all its versions.
- Only one version may hold `active` status at a time for a given `resource_id`.
- A rollback target must belong to the same `resource_id`, `tenant_id`, and `workspace_id` as the active function action.
- The currently active version is not a valid rollback target.
- Historical visibility must never cross tenant or workspace boundaries.

## Non-Goals

- Final database schema naming.
- Secret material storage.
- Retention/quota policy for historical versions.
- Full audit event model beyond what is required to explain lifecycle behavior for this task.
