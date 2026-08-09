import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cp = readFileSync(new URL('../../apps/control-plane/Dockerfile', import.meta.url), 'utf8');
const ex = readFileSync(new URL('../../apps/control-plane-executor/Dockerfile', import.meta.url), 'utf8');
const migrations = readFileSync(new URL('../../apps/control-plane/required-migrations.txt', import.meta.url), 'utf8');

test('runtime modules are copied into both service images with safe defaults', () => {
  for (const dockerfile of [cp, ex]) {
    assert.match(dockerfile, /knative-runtime\.mjs/);
    assert.match(dockerfile, /runtime-cleanup-repository\.mjs/);
    assert.match(dockerfile, /KNATIVE_RUNTIME_MODE=disabled/);
    assert.match(dockerfile, /KNATIVE_RUNTIME_STATUS_FILE=\/var\/run\/falcone\/knative\/status\.json/);
    assert.match(dockerfile, /FUNCTIONS_ENABLED=true/);
  }
});

test('cleanup migration is discovered after earlier numbered migrations', () => {
  assert.match(migrations, /118-config-preflight\.sql[\s\S]*122-knative-runtime-cleanup\.sql/);
  assert.match(migrations, /Keep this migration applied while obligations exist/);
});
