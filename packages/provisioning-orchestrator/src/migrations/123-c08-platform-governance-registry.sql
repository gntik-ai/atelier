-- Migration 123: C-08 platform-governance registry, idempotency and audit ledger.
--
-- This is the authoritative additive schema for the five platform-governance POST/GET
-- pairs published by the unified control-plane OpenAPI.  It deliberately does not alter
-- the legacy UUID `plans`, quota override, IAM or tenant tables.  Re-applying the forward
-- section is safe.  Emergency application rollback is data-retaining: an older image
-- simply ignores these tables.

-- up

CREATE TABLE IF NOT EXISTS platform_governance_entities (
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'deployment_profile', 'plan', 'quota_policy', 'provider_capability', 'platform_user'
  )),
  entity_id   TEXT NOT NULL,
  parent_id   TEXT,
  slug        TEXT,
  state       TEXT NOT NULL,
  projection  JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (entity_type, entity_id),
  CHECK (jsonb_typeof(projection) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_governance_entity_slug
  ON platform_governance_entities (entity_type, COALESCE(parent_id, ''), lower(slug))
  WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_governance_entity_parent
  ON platform_governance_entities (entity_type, parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_governance_user_subject
  ON platform_governance_entities ((projection->>'identitySubject'))
  WHERE entity_type = 'platform_user';
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_governance_user_email
  ON platform_governance_entities (lower(projection->>'primaryEmail'))
  WHERE entity_type = 'platform_user';

-- The accepted-command row is also the replay source.  Idempotency is isolated by
-- operation and verified actor: reuse in a different API operation or by another actor
-- cannot reveal or replay someone else's response.  The handler removes an expired row
-- while holding the same advisory transaction lock before accepting a new effect.
CREATE TABLE IF NOT EXISTS platform_governance_commands (
  command_id          TEXT PRIMARY KEY,
  operation_id        TEXT NOT NULL,
  request_id          TEXT NOT NULL,
  idempotency_key     TEXT NOT NULL,
  entity_type         TEXT NOT NULL,
  entity_id           TEXT NOT NULL,
  parent_id           TEXT,
  request_fingerprint TEXT NOT NULL,
  response_body       JSONB NOT NULL,
  accepted_event_type TEXT NOT NULL,
  desired_state       TEXT NOT NULL,
  correlation_id      TEXT NOT NULL,
  actor_id            TEXT NOT NULL,
  accepted_at         TIMESTAMPTZ NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  CHECK (jsonb_typeof(response_body) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_platform_governance_command_idempotency
  ON platform_governance_commands (operation_id, actor_id, idempotency_key, accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_governance_command_entity
  ON platform_governance_commands (entity_type, entity_id, accepted_at DESC);

-- The renewable 24-hour replay lease is separate from immutable command/audit history.
-- Expiry deletes only this receipt, never the domain entity, command or audit evidence.
CREATE TABLE IF NOT EXISTS platform_governance_idempotency (
  operation_id        TEXT NOT NULL,
  actor_id            TEXT NOT NULL,
  idempotency_key     TEXT NOT NULL,
  command_id          TEXT NOT NULL REFERENCES platform_governance_commands(command_id),
  request_fingerprint TEXT NOT NULL,
  response_body       JSONB NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (operation_id, actor_id, idempotency_key),
  CHECK (jsonb_typeof(response_body) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_platform_governance_idempotency_expiry
  ON platform_governance_idempotency (expires_at);

-- Platform mutations cannot be placed in the tenant hash chain: plan_audit_events has a
-- mandatory tenant boundary.  Keep a separate append-only, tamper-evident platform chain
-- and write it in the SAME transaction as the entity and command.  No secrets or request
-- bodies are stored; detail contains only bounded identifiers and state.
CREATE TABLE IF NOT EXISTS platform_governance_audit (
  audit_id            TEXT PRIMARY KEY,
  command_id          TEXT NOT NULL UNIQUE REFERENCES platform_governance_commands(command_id),
  operation_id        TEXT NOT NULL,
  actor_id            TEXT NOT NULL,
  entity_type         TEXT NOT NULL,
  entity_id           TEXT NOT NULL,
  correlation_id      TEXT NOT NULL,
  accepted_event_type TEXT NOT NULL,
  outcome              TEXT NOT NULL CHECK (outcome = 'accepted'),
  detail               JSONB NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL,
  prev_hash            TEXT NOT NULL DEFAULT '',
  row_hash             TEXT NOT NULL,
  CHECK (jsonb_typeof(detail) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_platform_governance_audit_created
  ON platform_governance_audit (created_at DESC, audit_id DESC);
CREATE INDEX IF NOT EXISTS idx_platform_governance_audit_correlation
  ON platform_governance_audit (correlation_id);

-- Function audit responses are not released until the durable audit row and this
-- Kafka outbox record commit together.  A background publisher retries pending
-- rows; a broker outage therefore cannot silently erase the canonical
-- `function.audit.events` emission required by BI-FN-AUD-001.
CREATE TABLE IF NOT EXISTS function_audit_outbox (
  event_id        UUID PRIMARY KEY,
  topic           TEXT NOT NULL CHECK (topic = 'function.audit.events'),
  event_key       TEXT NOT NULL,
  payload         JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at    TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_function_audit_outbox_pending
  ON function_audit_outbox (next_attempt_at, created_at)
  WHERE published_at IS NULL;

-- Durable pre-effect intents close the gap between an external Knative mutation and
-- its audit/outbox transaction. The handler writes the intent before the first
-- external effect, then finalizes it into plan_audit_events + outbox. If the process
-- or database fails after the effect, the retry worker converts the expired intent
-- into an error audit event rather than silently losing the attempt.
CREATE TABLE IF NOT EXISTS function_audit_intents (
  intent_id       UUID PRIMARY KEY,
  action_type     VARCHAR(64) NOT NULL,
  actor_id        VARCHAR(255) NOT NULL,
  tenant_id       VARCHAR(255) NOT NULL,
  workspace_id    VARCHAR(255) NOT NULL,
  correlation_id  VARCHAR(255),
  detail          JSONB NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  recovery_due_at TIMESTAMPTZ NOT NULL,
  finalized_at    TIMESTAMPTZ,
  audit_event_id  UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_function_audit_intents_recovery
  ON function_audit_intents (recovery_due_at, created_at)
  WHERE finalized_at IS NULL;

-- down
-- Destructive and therefore never part of normal rollback.  Export/verify first.
DROP TABLE IF EXISTS function_audit_intents;
DROP TABLE IF EXISTS function_audit_outbox;
DROP TABLE IF EXISTS platform_governance_audit;
DROP TABLE IF EXISTS platform_governance_idempotency;
DROP TABLE IF EXISTS platform_governance_commands;
DROP TABLE IF EXISTS platform_governance_entities;
