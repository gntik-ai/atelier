# Data Model — 097 Plan Entity & Tenant Plan Assignment

## Tables

### plans

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `slug VARCHAR(64) NOT NULL`, unique via `uq_plans_slug_lower` on `LOWER(slug)`
- `display_name VARCHAR(255) NOT NULL`
- `description TEXT NULL`
- `status VARCHAR(20) NOT NULL CHECK IN (draft, active, deprecated, archived)`
- `capabilities JSONB NOT NULL DEFAULT '{}'::jsonb` (`string -> boolean`)
- `quota_dimensions JSONB NOT NULL DEFAULT '{}'::jsonb` (`string -> finite number`)
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `created_by VARCHAR(255) NOT NULL`
- `updated_by VARCHAR(255) NOT NULL`

Indexes:
- `uq_plans_slug_lower`
- `idx_plans_status`

Triggers:
- `trg_plans_set_updated_at`
- `trg_plans_enforce_status_forward_only`

### tenant_plan_assignments

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `tenant_id VARCHAR(255) NOT NULL`
- `plan_id UUID NOT NULL REFERENCES plans(id)`
- `effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `superseded_at TIMESTAMPTZ NULL`
- `assigned_by VARCHAR(255) NOT NULL`
- `assignment_metadata JSONB NOT NULL DEFAULT '{}'::jsonb`

Indexes:
- partial unique `uq_tenant_plan_assignments_current` on `(tenant_id) WHERE superseded_at IS NULL`
- `idx_tenant_plan_assignments_tenant_history`
- `idx_tenant_plan_assignments_plan_id`

### plan_audit_events

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `action_type VARCHAR(64) NOT NULL`
- `actor_id VARCHAR(255) NOT NULL`
- `tenant_id VARCHAR(255) NULL`
- `plan_id UUID NULL REFERENCES plans(id)`
- `previous_state JSONB NULL`
- `new_state JSONB NOT NULL`
- `correlation_id VARCHAR(255) NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Indexes:
- `idx_plan_audit_events_actor_created`
- `idx_plan_audit_events_tenant_created`
- `idx_plan_audit_events_action_created`

## Lifecycle

`draft -> active -> deprecated -> archived`

Both the application layer and a PostgreSQL trigger reject backward or skip transitions.

## JSONB Conventions

- `capabilities`: flat boolean map, example `{ "webhooks_enabled": true }`
- `quota_dimensions`: flat numeric map, example `{ "max_workspaces": 5 }`
- `assignment_metadata`: freeform object for reason/ticket context
