import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFilter } from '../../../services/realtime-gateway/src/filters/filter-parser.mjs';
import { evaluateFilter } from '../../../services/realtime-gateway/src/filters/filter-evaluator.mjs';
import { guardEvent } from '../../../services/realtime-gateway/src/isolation/tenant-workspace-guard.mjs';

test('filtered subscriptions only receive matching permitted events and reduce delivery volume by at least 50%', () => {
  const sessionContext = { tenantId: 'tenant-1', workspaceId: 'workspace-1' };
  const filterSpec = parseFilter({ operation: 'INSERT', entity: 'orders' });
  const unfilteredSpec = parseFilter(null);
  const events = [
    { tenantId: 'tenant-1', workspaceId: 'workspace-1', operation: 'INSERT', entity: 'orders', data: { id: 1 } },
    { tenantId: 'tenant-1', workspaceId: 'workspace-1', operation: 'UPDATE', entity: 'orders', data: { id: 1 } },
    { tenantId: 'tenant-1', workspaceId: 'workspace-1', operation: 'INSERT', entity: 'customers', data: { id: 2 } },
    { tenantId: 'tenant-1', workspaceId: 'workspace-1', operation: 'INSERT', entity: 'orders', data: { id: 3 } },
    { tenantId: 'tenant-1', workspaceId: 'workspace-2', operation: 'INSERT', entity: 'orders', data: { id: 4 } },
    { tenantId: 'tenant-2', workspaceId: 'workspace-1', operation: 'INSERT', entity: 'orders', data: { id: 5 } }
  ];

  const permittedEvents = events.filter((event) => guardEvent(event, sessionContext));
  const filteredEvents = permittedEvents.filter((event) => evaluateFilter(filterSpec, event));
  const unfilteredEvents = permittedEvents.filter((event) => evaluateFilter(unfilteredSpec, event));

  assert.deepEqual(filteredEvents.map((event) => event.data.id), [1, 3]);
  assert.equal(unfilteredEvents.length, 4);
  assert.ok(filteredEvents.length <= unfilteredEvents.length / 2);
});
