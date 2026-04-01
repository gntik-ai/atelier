import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv from 'ajv';

const SCHEMA_PATH = resolve('specs/118-export-conflict-prechecks/contracts/config-preflight-audit-event.json');

let schema;
let ajv;

function validEvent() {
  return {
    event_id: '550e8400-e29b-41d4-a716-446655440000',
    event_type: 'config.preflight.executed',
    emitted_at: '2026-04-01T18:00:00.000Z',
    correlation_id: 'pf-abc123',
    actor: { id: 'sre-1', type: 'sre' },
    tenant: { target_id: 'tenant-dest', source_id: 'tenant-source' },
    artifact: { format_version: '1.0.0', checksum: null },
    analysis: {
      risk_level: 'medium',
      incomplete_analysis: false,
      needs_confirmation: false,
      domains_analyzed: ['iam', 'kafka'],
      domains_skipped: [],
      conflict_counts: { low: 0, medium: 1, high: 0, critical: 0 },
      total_resources_analyzed: 5,
      duration_ms: 1200,
    },
  };
}

test('config-preflight-audit-event: schema file is valid JSON Schema', async () => {
  const raw = await readFile(SCHEMA_PATH, 'utf-8');
  schema = JSON.parse(raw);
  assert.ok(schema);
  ajv = new Ajv({ strict: false, allErrors: true });
});

test('config-preflight-audit-event: valid event passes validation', async () => {
  const raw = await readFile(SCHEMA_PATH, 'utf-8');
  schema = JSON.parse(raw);
  ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);
  const valid = validate(validEvent());
  assert.ok(valid, `Validation errors: ${JSON.stringify(validate.errors)}`);
});

test('config-preflight-audit-event: event without event_type fails', async () => {
  const raw = await readFile(SCHEMA_PATH, 'utf-8');
  schema = JSON.parse(raw);
  ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);
  const event = validEvent();
  delete event.event_type;
  assert.equal(validate(event), false);
});

test('config-preflight-audit-event: event without actor fails', async () => {
  const raw = await readFile(SCHEMA_PATH, 'utf-8');
  schema = JSON.parse(raw);
  ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);
  const event = validEvent();
  delete event.actor;
  assert.equal(validate(event), false);
});

test('config-preflight-audit-event: actor type tenant_owner fails', async () => {
  const raw = await readFile(SCHEMA_PATH, 'utf-8');
  schema = JSON.parse(raw);
  ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);
  const event = validEvent();
  event.actor.type = 'tenant_owner';
  assert.equal(validate(event), false);
});

test('config-preflight-audit-event: event_type must be config.preflight.executed', async () => {
  const raw = await readFile(SCHEMA_PATH, 'utf-8');
  schema = JSON.parse(raw);
  ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);
  const event = validEvent();
  event.event_type = 'config.reprovision.completed';
  assert.equal(validate(event), false);
});

test('config-preflight-audit-event: additionalProperties rejects extra fields', async () => {
  const raw = await readFile(SCHEMA_PATH, 'utf-8');
  schema = JSON.parse(raw);
  ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);
  const event = validEvent();
  event.extra_field = 'should_fail';
  const valid = validate(event);
  assert.equal(valid, false);
});
