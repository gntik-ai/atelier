import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSdk } from '../src/sdk-builder.mjs';

const spec = JSON.stringify({ openapi: '3.1.0', info: { title: 't', version: '1.0.0' }, paths: {} });

test('TypeScript build uses typescript-fetch generator with package properties', async () => {
  const calls = [];
  await assert.rejects(
    () => buildSdk(spec, 'typescript', 'workspace_12345678', '1.2.3', { execFileAsync: async (...args) => { calls.push(args); throw new Error('stop'); } }),
    /stop/
  );
  assert.equal(calls[0][0], 'openapi-generator-cli');
  assert.ok(calls[0][1].includes('typescript-fetch'));
  assert.ok(calls[0][1].join(' ').includes('packageName=workspace-workspac-sdk,packageVersion=1.2.3'));
});

test('Python build uses python generator', async () => {
  const calls = [];
  await assert.rejects(
    () => buildSdk(spec, 'python', 'workspace_12345678', '1.2.3', { execFileAsync: async (...args) => { calls.push(args); throw new Error('stop'); } }),
    /stop/
  );
  assert.ok(calls[0][1].includes('python'));
});

test('Build timeout is 240000ms', async () => {
  const calls = [];
  await assert.rejects(
    () => buildSdk(spec, 'python', 'workspace_12345678', '1.2.3', { execFileAsync: async (...args) => { calls.push(args); throw new Error('stop'); } }),
    /stop/
  );
  assert.equal(calls[0][2].timeout, 240000);
});

test('buildSdk propagates execFile errors', async () => {
  await assert.rejects(
    () => buildSdk(spec, 'python', 'workspace_12345678', '1.2.3', { execFileAsync: async () => { throw new Error('boom'); } }),
    /boom/
  );
});

test('buildSdk rejects unsafe workspace ids before invoking the generator', async () => {
  await assert.rejects(
    () => buildSdk(spec, 'typescript', 'workspace,evil', '1.2.3', { execFileAsync: async () => ({}) }),
    /workspaceId contains unsupported characters/
  );
});

test('buildSdk rejects invalid package versions before invoking the generator', async () => {
  await assert.rejects(
    () => buildSdk(spec, 'typescript', 'workspace_12345678', '1.2.3;rm', { execFileAsync: async () => ({}) }),
    /specVersion must be a valid semantic version/
  );
});
