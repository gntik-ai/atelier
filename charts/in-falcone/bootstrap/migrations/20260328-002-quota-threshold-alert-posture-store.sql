-- US-OBS-03-T03: last-known quota posture store for threshold alert deduplication.
-- workspace_id uses NULL for tenant-scoped entries; the PK uses COALESCE(workspace_id, '') to satisfy the constraint.
-- Workspace deletion must purge related rows via a cleanup hook.
CREATE TABLE quota_last_known_posture (
    tenant_id          TEXT        NOT NULL,
    workspace_id       TEXT,
    dimension_id       TEXT        NOT NULL,
    posture_state      TEXT        NOT NULL,
    evaluated_at       TIMESTAMPTZ NOT NULL,
    snapshot_timestamp TIMESTAMPTZ NOT NULL,
    correlation_id     TEXT        NOT NULL,
    PRIMARY KEY (tenant_id, COALESCE(workspace_id, ''), dimension_id)
);

CREATE INDEX ON quota_last_known_posture (tenant_id);
CREATE INDEX ON quota_last_known_posture (tenant_id, workspace_id);
