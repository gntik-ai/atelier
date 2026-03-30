import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv from 'ajv';

const doc = JSON.parse(fs.readFileSync(new URL('../../apps/control-plane/openapi/families/workspaces.openapi.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: false });

function compile(schemaName) {
  const schema = doc.components.schemas[schemaName];
  return ajv.compile(schema);
}

for (const [fixture, schemaName] of [
  ['rotation-status.schema.json', 'CredentialRotationStatus'],
  ['rotation-history.schema.json', 'CredentialRotationHistoryEntry'],
  ['tenant-rotation-policy.schema.json', 'TenantRotationPolicy']
]) {
  test(`fixture ${fixture} matches ${schemaName}`, () => {
    const validate = compile(schemaName);
    const payload = JSON.parse(fs.readFileSync(new URL(`../../specs/089-api-key-rotation/contracts/${fixture}`, import.meta.url), 'utf8'));
    assert.equal(validate(payload), true, JSON.stringify(validate.errors));
  });
}
