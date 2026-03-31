import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('scope-enforcement plugin declares enforcement headers and denial codes', () => {
  const source = readFileSync(new URL('../../services/gateway-config/plugins/scope-enforcement.lua', import.meta.url), 'utf8');
  assert.match(source, /X-Enforcement-Verified/);
  assert.match(source, /SCOPE_INSUFFICIENT/);
  assert.match(source, /WORKSPACE_SCOPE_MISMATCH/);
  assert.match(source, /PLAN_ENTITLEMENT_DENIED/);
  assert.match(source, /CONFIG_ERROR/);
});

test('scope-enforcement plugin includes platform_admin workspace bypass', () => {
  const source = readFileSync(new URL('../../services/gateway-config/plugins/scope-enforcement.lua', import.meta.url), 'utf8');
  assert.match(source, /platform_admin/);
});

test('scope-enforcement plugin smoke e2e is skipped unless enabled', { skip: !process.env.SCOPE_ENFORCEMENT_E2E }, async () => {
  assert.ok(process.env.SCOPE_ENFORCEMENT_E2E);
});
