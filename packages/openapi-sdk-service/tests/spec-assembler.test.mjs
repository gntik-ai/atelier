import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleSpec, computeNextVersion } from '../src/spec-assembler.mjs';

test('assembleSpec includes enabled capability paths and excludes disabled paths', () => {
  const assembled = assembleSpec({
    enabledCapabilities: new Set(['storage', 'authentication']),
    workspaceBaseUrl: 'https://api.example.test/v1/workspaces/ws_123',
    previousSpecVersion: '1.0.0',
    previousCapabilityTags: ['authentication']
  });
  const spec = JSON.parse(assembled.formatJson);
  assert.ok(spec.paths['/buckets']);
  assert.ok(spec.paths['/auth/tokens']);
  assert.equal(spec.paths['/channels'], undefined);
  assert.equal(spec.paths['/mongo/collections'], undefined);
  const createToken = spec.paths['/auth/tokens'].post;
  assert.deepEqual(createToken.parameters.slice(0, 2), [
    { $ref: '#/components/parameters/XApiVersion' },
    { $ref: '#/components/parameters/XCorrelationId' }
  ]);
  assert.equal(spec.components.parameters.XApiVersion.schema.const, '2026-03-26');
  assert.equal(spec.components.parameters.XCorrelationId.required, false);
  for (const response of Object.values(createToken.responses)) {
    assert.deepEqual(response.headers['X-Correlation-Id'], { $ref: '#/components/headers/XCorrelationId' });
  }
});

test('assembleSpec with empty set produces valid empty paths object', () => {
  const assembled = assembleSpec({ enabledCapabilities: new Set(), workspaceBaseUrl: 'https://api.example.test', previousSpecVersion: '1.0.0', previousCapabilityTags: [] });
  const spec = JSON.parse(assembled.formatJson);
  assert.deepEqual(spec.paths, {});
});

test('computeNextVersion bumps semver according to capability delta', () => {
  assert.equal(computeNextVersion('1.2.3', ['storage'], ['storage', 'authentication']), '1.3.0');
  assert.equal(computeNextVersion('1.2.3', ['storage', 'authentication'], ['storage']), '2.0.0');
  assert.equal(computeNextVersion('1.2.3', ['storage'], ['storage']), '1.2.4');
});

test('contentHash format and server URL are correct', () => {
  const assembled = assembleSpec({ enabledCapabilities: new Set(['functions']), workspaceBaseUrl: 'https://api.example.test/w/ws', previousSpecVersion: '2.0.0', previousCapabilityTags: [] });
  const spec = JSON.parse(assembled.formatJson);
  assert.match(assembled.contentHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(spec.servers[0].url, 'https://api.example.test/w/ws');
});

test('assembled spec has valid OpenAPI scaffold structure', () => {
  const assembled = assembleSpec({ enabledCapabilities: new Set(['storage', 'authentication']), workspaceBaseUrl: 'https://api.example.test', previousSpecVersion: '1.0.0', previousCapabilityTags: [] });
  const spec = JSON.parse(assembled.formatJson);
  assert.equal(spec.openapi, '3.1.0');
  assert.equal(spec.info.version, '1.1.0');
  assert.ok(Array.isArray(spec.tags));
  assert.ok(spec.components.securitySchemes.BearerAuth);
});
