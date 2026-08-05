import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('runtime Dockerfiles package the shared normalizer', () => {
  const controlPlane = fs.readFileSync('apps/control-plane/Dockerfile', 'utf8');
  const executor = fs.readFileSync('apps/control-plane-executor/Dockerfile', 'utf8');
  assert.match(
    controlPlane,
    /COPY apps\/shared\/error-envelope\.mjs \/shared\/error-envelope\.mjs/,
    '/app/server.mjs imports ../shared/error-envelope.mjs, which resolves to /shared in the flattened image'
  );
  assert.match(
    executor,
    /COPY apps\/shared\/error-envelope\.mjs \/app\/apps\/shared\/error-envelope\.mjs/,
    'the executor preserves /app/apps/control-plane-executor/src/runtime and resolves the shared module at /app/apps/shared'
  );
});
