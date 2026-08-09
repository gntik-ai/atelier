// Unit tests for custom MCP server hosting (change add-mcp-custom-hosting, #394).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImageRef, isPinnedImage, buildCustomServerDeployment } from './mcp-custom-hosting.mjs';

test('parseImageRef: registry / name / tag / digest', () => {
  assert.deepEqual(parseImageRef('localhost:30500/my-srv:v1'), { registry: 'localhost:30500', name: 'my-srv', tag: 'v1', digest: null });
  assert.deepEqual(parseImageRef('harbor.example.com/team/srv@sha256:abc'), { registry: 'harbor.example.com', name: 'team/srv', tag: null, digest: 'sha256:abc' });
  assert.equal(parseImageRef('busybox:latest').registry, null); // docker hub default
});

test('isPinnedImage: digest or concrete tag = pinned; latest/none = unpinned', () => {
  assert.equal(isPinnedImage('r/n:v1'), true);
  assert.equal(isPinnedImage('r/n@sha256:abc'), true);
  assert.equal(isPinnedImage('r/n:latest'), false);
  assert.equal(isPinnedImage('localhost:30500/n'), false); // no tag/digest
});

test('valid image -> ksvc: mcp-server label, min-scale 0, non-root securityContext', () => {
  const { manifest, violations } = buildCustomServerDeployment({
    tenantId: 'ten_A', serverId: 's1', image: 'localhost:30500/byo:v1',
    namespace: 'mcp-ten-a', allowedRegistries: ['localhost:30500'],
  });
  assert.deepEqual(violations, []);
  assert.equal(manifest.kind, 'Service');
  assert.equal(manifest.metadata.namespace, 'mcp-ten-a');
  assert.equal(manifest.metadata.labels['in-falcone.io/component'], 'mcp-server');
  const tmpl = manifest.spec.template;
  assert.equal(tmpl.metadata.annotations['autoscaling.knative.dev/min-scale'], '0');
  assert.equal(tmpl.metadata.labels['in-falcone.io/component'], 'mcp-server'); // pod label for NetworkPolicy
  const sc = tmpl.spec.containers[0].securityContext;
  assert.equal(sc.runAsNonRoot, true);
  assert.equal(sc.allowPrivilegeEscalation, false);
  assert.deepEqual(sc.capabilities.drop, ['ALL']);
});

test('disallowed registry -> violation, no manifest', () => {
  const { manifest, violations } = buildCustomServerDeployment({
    tenantId: 't', serverId: 's', image: 'docker.io/evil:v1', allowedRegistries: ['localhost:30500'],
  });
  assert.equal(manifest, null);
  assert.ok(violations.some((v) => v.code === 'registry_not_allowed'));
});

test('unpinned / latest image -> violation', () => {
  for (const image of ['localhost:30500/x:latest', 'localhost:30500/x']) {
    const { violations } = buildCustomServerDeployment({ tenantId: 't', serverId: 's', image, allowedRegistries: ['localhost:30500'] });
    assert.ok(violations.some((v) => v.code === 'image_not_pinned'), `${image} should be rejected`);
  }
});

test('missing required fields -> violations', () => {
  const { violations } = buildCustomServerDeployment({ image: 'localhost:30500/x:v1', allowedRegistries: ['localhost:30500'] });
  assert.ok(violations.some((v) => v.code === 'missing_tenant'));
  assert.ok(violations.some((v) => v.code === 'missing_server_id'));
});

test('no allow-list -> any pinned image accepted', () => {
  const { manifest, violations } = buildCustomServerDeployment({
    tenantId: 't', serverId: 's', namespace: 'mcp-t', image: 'ghcr.io/acme/srv:1.2.3',
  });
  assert.deepEqual(violations, []);
  assert.equal(manifest.spec.template.spec.containers[0].image, 'ghcr.io/acme/srv:1.2.3');
});
