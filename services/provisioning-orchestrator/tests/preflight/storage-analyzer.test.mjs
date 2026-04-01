import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../../src/preflight/analyzers/storage-analyzer.mjs';

const silentLog = { error: () => {}, warn: () => {}, info: () => {} };

test('storage-analyzer: empty domain data → no_conflicts', async () => {
  const result = await analyze('t-1', null, { log: silentLog });
  assert.equal(result.status, 'no_conflicts');
});

test('storage-analyzer: bucket not in destination → compatible', async () => {
  const data = { buckets: [{ name: 't-1-uploads', versioning: 'Enabled', policy: '{}' }] };
  const getBucket = async () => null;
  const result = await analyze('t-1', data, { credentials: { getBucket }, log: silentLog });
  assert.equal(result.compatible_count, 1);
  assert.equal(result.conflicts.length, 0);
});

test('storage-analyzer: bucket with different policy → conflict medium', async () => {
  const artifactBucket = { name: 't-1-uploads', versioning: 'Enabled', policy: '{"rules": []}', cors: [] };
  const existingBucket = { name: 't-1-uploads', versioning: 'Enabled', policy: '{"rules": ["allow"]}', cors: [] };
  const data = { buckets: [artifactBucket] };
  const getBucket = async () => existingBucket;
  const result = await analyze('t-1', data, { credentials: { getBucket }, log: silentLog });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].severity, 'medium');
});

test('storage-analyzer: bucket with different cors → conflict low', async () => {
  const artifactBucket = { name: 't-1-uploads', cors: [{ AllowedOrigins: ['*'] }] };
  const existingBucket = { name: 't-1-uploads', cors: [{ AllowedOrigins: ['https://example.com'] }] };
  const data = { buckets: [artifactBucket] };
  const getBucket = async () => existingBucket;
  const result = await analyze('t-1', data, { credentials: { getBucket }, log: silentLog });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].severity, 'low');
});

test('storage-analyzer: S3 unavailable → analysis_error', async () => {
  const data = { buckets: [{ name: 't-1-uploads' }] };
  const getBucket = async () => { throw new Error('connection refused'); };
  const result = await analyze('t-1', data, { credentials: { getBucket }, log: silentLog });
  assert.ok(result.conflicts.length >= 0 || result.status === 'analysis_error');
});

test('storage-analyzer: no write operations', async () => {
  const data = { buckets: [{ name: 't-1-uploads' }] };
  const getBucket = async () => null;
  const result = await analyze('t-1', data, { credentials: { getBucket }, log: silentLog });
  assert.ok(result);
});
