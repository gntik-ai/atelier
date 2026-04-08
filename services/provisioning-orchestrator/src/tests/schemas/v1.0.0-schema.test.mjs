import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchemaFor } from '../../schemas/index.mjs';
import { validate } from '../../schemas/schema-validator.mjs';

const schema = getSchemaFor('1.0.0');

function makeValidArtifact(overrides = {}) {
  return {
    export_timestamp: '2026-04-01T14:00:00.000Z',
    tenant_id: 'tenant-abc',
    format_version: '1.0.0',
    deployment_profile: 'standard',
    correlation_id: 'req-123456',
    schema_checksum: 'sha256:' + 'a'.repeat(64),
    domains: [
      {
        domain_key: 'iam',
        status: 'ok',
        exported_at: '2026-04-01T14:00:01.000Z',
        items_count: 5,
        data: { roles: [] },
      },
    ],
    ...overrides,
  };
}

test('schema exists and has correct title', () => {
  assert.ok(schema);
  assert.equal(schema.title, 'Falcone Tenant Config Export Artifact — v1.0.0');
});

test('validates a fully conforming artifact as valid', () => {
  const artifact = makeValidArtifact();
  const result = validate(artifact, schema);
  assert.ok(result.valid, `Expected valid but got errors: ${JSON.stringify(result.errors)}`);
  assert.equal(result.errors.length, 0);
});

test('validates artifact with all-ok domains', () => {
  const artifact = makeValidArtifact({
    domains: [
      { domain_key: 'iam', status: 'ok', exported_at: '2026-04-01T14:00:01Z', data: {} },
      { domain_key: 'postgres', status: 'ok', exported_at: '2026-04-01T14:00:02Z', data: {} },
      { domain_key: 'kafka', status: 'empty', exported_at: '2026-04-01T14:00:03Z', data: null },
    ],
  });
  const result = validate(artifact, schema);
  assert.ok(result.valid);
});

test('validates artifact with partial error domains', () => {
  const artifact = makeValidArtifact({
    domains: [
      { domain_key: 'iam', status: 'ok', exported_at: '2026-04-01T14:00:01Z', data: {} },
      { domain_key: 'mongo', status: 'error', exported_at: '2026-04-01T14:00:02Z', error: 'Connection refused' },
    ],
  });
  const result = validate(artifact, schema);
  assert.ok(result.valid);
});

test('validates artifact with not_available domain', () => {
  const artifact = makeValidArtifact({
    domains: [
      { domain_key: 'functions', status: 'not_available', exported_at: '2026-04-01T14:00:01Z', reason: 'OpenWhisk not deployed' },
    ],
  });
  const result = validate(artifact, schema);
  assert.ok(result.valid);
});

test('reports warnings for extra unknown fields at root level', () => {
  const artifact = makeValidArtifact({ custom_field: 'hello' });
  const result = validate(artifact, schema);
  assert.ok(result.valid);
  assert.ok(result.warnings.length > 0, 'Should have warnings for unknown field');
  assert.ok(result.warnings.some(w => w.path.includes('custom_field')));
});

test('reports warnings for extra unknown fields in DomainSection', () => {
  const artifact = makeValidArtifact({
    domains: [
      {
        domain_key: 'iam',
        status: 'ok',
        exported_at: '2026-04-01T14:00:01Z',
        data: {},
        my_custom: 'extra',
      },
    ],
  });
  const result = validate(artifact, schema);
  assert.ok(result.valid);
  assert.ok(result.warnings.some(w => w.path.includes('my_custom')));
});

test('rejects artifact missing required field tenant_id', () => {
  const artifact = makeValidArtifact();
  delete artifact.tenant_id;
  const result = validate(artifact, schema);
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.message.includes('tenant_id')));
});

test('rejects artifact missing required field format_version', () => {
  const artifact = makeValidArtifact();
  delete artifact.format_version;
  const result = validate(artifact, schema);
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.message.includes('format_version')));
});

test('rejects artifact missing required field schema_checksum', () => {
  const artifact = makeValidArtifact();
  delete artifact.schema_checksum;
  const result = validate(artifact, schema);
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.message.includes('schema_checksum')));
});

test('rejects artifact with invalid deployment_profile', () => {
  const artifact = makeValidArtifact({ deployment_profile: 'custom_invalid' });
  const result = validate(artifact, schema);
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.path.includes('deployment_profile')));
});

test('rejects artifact with invalid format_version pattern', () => {
  const artifact = makeValidArtifact({ format_version: '2.0.0' });
  const result = validate(artifact, schema);
  assert.ok(!result.valid, 'format_version 2.0.0 should not match ^1\\.\\d+\\.\\d+$ pattern');
});

test('rejects artifact with invalid schema_checksum pattern', () => {
  const artifact = makeValidArtifact({ schema_checksum: 'md5:abc' });
  const result = validate(artifact, schema);
  assert.ok(!result.valid);
});

test('rejects DomainSection with invalid status', () => {
  const artifact = makeValidArtifact({
    domains: [{ domain_key: 'iam', status: 'unknown_status', exported_at: '2026-04-01T14:00:01Z' }],
  });
  const result = validate(artifact, schema);
  assert.ok(!result.valid);
});

test('rejects DomainSection missing required fields', () => {
  const artifact = makeValidArtifact({
    domains: [{ domain_key: 'iam' }], // missing status and exported_at
  });
  const result = validate(artifact, schema);
  assert.ok(!result.valid);
  assert.ok(result.errors.some(e => e.message.includes('status')));
  assert.ok(result.errors.some(e => e.message.includes('exported_at')));
});
