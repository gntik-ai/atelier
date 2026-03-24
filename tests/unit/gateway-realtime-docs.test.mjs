import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const docPath = 'docs/reference/architecture/gateway-realtime-and-event-gateway.md';

test('gateway realtime architecture doc preserves metrics, usage guidance, and residual risk notes', () => {
  const markdown = readFileSync(docPath, 'utf8');

  assert.ok(markdown.includes('/apisix/prometheus/metrics'));
  assert.ok(markdown.includes('/v1/events/topics/{resourceId}/publish'));
  assert.ok(markdown.includes('/v1/events/topics/{resourceId}/stream'));
  assert.ok(markdown.includes('/v1/websockets/sessions'));
  assert.ok(markdown.includes('US-EVT-02'));
  assert.ok(markdown.includes('Do not connect directly to Kafka'));
});
