CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_plan_status_forward_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'active' THEN
    RETURN NEW;
  ELSIF OLD.status = 'active' AND NEW.status = 'deprecated' THEN
    RETURN NEW;
  ELSIF OLD.status = 'deprecated' AND NEW.status = 'archived' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid plan status transition from % to %', OLD.status, NEW.status
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(64) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'deprecated', 'archived')),
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  quota_dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by VARCHAR(255) NOT NULL,
  updated_by VARCHAR(255) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_slug_lower ON plans (LOWER(slug));
CREATE INDEX IF NOT EXISTS idx_plans_status ON plans (status);

DROP TRIGGER IF EXISTS trg_plans_set_updated_at ON plans;
CREATE TRIGGER trg_plans_set_updated_at
BEFORE UPDATE ON plans
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_plans_enforce_status_forward_only ON plans;
CREATE TRIGGER trg_plans_enforce_status_forward_only
BEFORE UPDATE OF status ON plans
FOR EACH ROW
EXECUTE FUNCTION enforce_plan_status_forward_transition();

CREATE TABLE IF NOT EXISTS tenant_plan_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(255) NOT NULL,
  plan_id UUID NOT NULL REFERENCES plans(id),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at TIMESTAMPTZ,
  assigned_by VARCHAR(255) NOT NULL,
  assignment_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_plan_assignments_current
  ON tenant_plan_assignments (tenant_id)
  WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_plan_assignments_tenant_history
  ON tenant_plan_assignments (tenant_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_plan_assignments_plan_id
  ON tenant_plan_assignments (plan_id);

CREATE TABLE IF NOT EXISTS plan_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type VARCHAR(64) NOT NULL,
  actor_id VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255),
  plan_id UUID REFERENCES plans(id),
  previous_state JSONB,
  new_state JSONB NOT NULL,
  correlation_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_audit_events_actor_created
  ON plan_audit_events (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_audit_events_tenant_created
  ON plan_audit_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_audit_events_action_created
  ON plan_audit_events (action_type, created_at DESC);
