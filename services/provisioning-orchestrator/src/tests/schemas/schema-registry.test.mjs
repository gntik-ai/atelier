import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCurrentVersion,
  getMinMigratable,
  getSupportedVersions,
  getSchemaFor,
  getChecksum,
  isSameMajor,
  isKnownVersion,
  isFutureVersion,
  buildMigrationChain,
} from '../../schemas/index.mjs';

test('getCurrentVersion returns 1.0.0', () => {
  assert.equal(getCurrentVersion(), '1.0.0');
});

test('getMinMigratable returns 1.0.0', () => {
  assert.equal(getMinMigratable(), '1.0.0');
});

test('getSupportedVersions returns array with at least one entry', () => {
  const versions = getSupportedVersions();
  assert.ok(Array.isArray(versions));
  assert.ok(versions.length >= 1);
  const v1 = versions.find(v => v.version === '1.0.0');
  assert.ok(v1);
  assert.ok(v1.release_date);
  assert.ok(v1.change_notes);
  assert.ok(v1.schema_checksum);
});

test('getChecksum returns sha256-prefixed hex string', () => {
  const checksum = getChecksum('1.0.0');
  assert.ok(checksum);
  assert.match(checksum, /^sha256:[a-f0-9]{64}$/);
});

test('getChecksum is stable across calls', () => {
  const a = getChecksum('1.0.0');
  const b = getChecksum('1.0.0');
  assert.equal(a, b);
});

test('getChecksum returns null for unknown version', () => {
  assert.equal(getChecksum('99.0.0'), null);
});

test('getSchemaFor returns schema for exact version', () => {
  const schema = getSchemaFor('1.0.0');
  assert.ok(schema);
  assert.equal(schema.title, 'Falcone Tenant Config Export Artifact — v1.0.0');
});

test('getSchemaFor returns schema for same-major different minor', () => {
  const schema = getSchemaFor('1.3.0');
  assert.ok(schema, 'Should resolve to 1.0.0 schema for same major');
});

test('getSchemaFor returns null for unknown major', () => {
  assert.equal(getSchemaFor('5.0.0'), null);
});

test('isSameMajor returns true for same major', () => {
  assert.ok(isSameMajor('1.0.0', '1.3.0'));
  assert.ok(isSameMajor('1.0.0', '1.0.0'));
});

test('isSameMajor returns false for different major', () => {
  assert.ok(!isSameMajor('1.0.0', '2.0.0'));
});

test('isSameMajor returns false for invalid semver', () => {
  assert.ok(!isSameMajor('abc', '1.0.0'));
});

test('isKnownVersion returns true for 1.0.0', () => {
  assert.ok(isKnownVersion('1.0.0'));
});

test('isKnownVersion returns true for same-major variant', () => {
  assert.ok(isKnownVersion('1.2.0'));
});

test('isKnownVersion returns false for unknown version', () => {
  assert.ok(!isKnownVersion('99.0.0'));
});

test('isFutureVersion returns false for current', () => {
  assert.ok(!isFutureVersion('1.0.0'));
});

test('isFutureVersion returns true for higher major', () => {
  assert.ok(isFutureVersion('99.0.0'));
});

test('isFutureVersion returns true for higher minor', () => {
  assert.ok(isFutureVersion('1.1.0'));
});

test('buildMigrationChain returns empty for same major', () => {
  const { chain, fns } = buildMigrationChain('1.0.0', '1.0.0');
  assert.deepEqual(chain, []);
  assert.deepEqual(fns, []);
});

test('buildMigrationChain returns empty when from >= to', () => {
  const { chain, fns } = buildMigrationChain('2.0.0', '1.0.0');
  assert.deepEqual(chain, []);
  assert.deepEqual(fns, []);
});

test('buildMigrationChain throws for missing migration step', () => {
  // In v1 there are no migrations registered, so 0→1 should throw
  assert.throws(
    () => buildMigrationChain('0.0.0', '1.0.0'),
    /Missing migration step/
  );
});
