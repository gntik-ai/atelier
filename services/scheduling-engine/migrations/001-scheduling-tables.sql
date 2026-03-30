CREATE TABLE IF NOT EXISTS scheduling_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    workspace_id TEXT,
    scheduling_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    max_active_jobs INT NOT NULL DEFAULT 10,
    min_interval_seconds INT NOT NULL DEFAULT 60,
    max_consecutive_failures INT NOT NULL DEFAULT 5,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_sc_tenant ON scheduling_configurations (tenant_id);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    target_action TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'active',
    consecutive_failure_count INT NOT NULL DEFAULT 0,
    max_consecutive_failures INT NOT NULL DEFAULT 5,
    next_run_at TIMESTAMPTZ,
    last_triggered_at TIMESTAMPTZ,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sj_tenant_workspace ON scheduled_jobs (tenant_id, workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sj_status_next_run ON scheduled_jobs (status, next_run_at) WHERE status = 'active' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS scheduled_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES scheduled_jobs(id),
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    scheduled_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    duration_ms INT,
    error_summary TEXT,
    correlation_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, scheduled_at)
);

CREATE INDEX IF NOT EXISTS idx_se_job ON scheduled_executions (job_id);
CREATE INDEX IF NOT EXISTS idx_se_tenant_workspace ON scheduled_executions (tenant_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_se_status ON scheduled_executions (status);
