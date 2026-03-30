SET search_path TO workspace_docs_service;

CREATE TABLE IF NOT EXISTS workspace_doc_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  content TEXT NOT NULL,
  author_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_workspace_doc_notes_workspace
  ON workspace_doc_notes (tenant_id, workspace_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS workspace_doc_access_log (
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  access_date DATE NOT NULL DEFAULT current_date,
  PRIMARY KEY (workspace_id, actor_id, access_date)
);

CREATE INDEX IF NOT EXISTS idx_workspace_doc_access_log_workspace
  ON workspace_doc_access_log (workspace_id, actor_id, access_date);
