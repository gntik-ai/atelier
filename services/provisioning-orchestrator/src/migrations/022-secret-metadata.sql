-- secret metadata only; no secret value column is ever allowed in this table.
CREATE TABLE IF NOT EXISTS secret_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_path TEXT NOT NULL,
  domain TEXT NOT NULL,
  tenant_id UUID,
  secret_name TEXT NOT NULL,
  secret_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_accessed_at TIMESTAMPTZ,
  created_by TEXT,
  vault_mount TEXT NOT NULL DEFAULT 'secret',
  UNIQUE (domain, tenant_id, secret_name)
);

CREATE INDEX IF NOT EXISTS idx_secret_metadata_domain ON secret_metadata(domain);
CREATE INDEX IF NOT EXISTS idx_secret_metadata_tenant ON secret_metadata(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_secret_metadata_status ON secret_metadata(status);
