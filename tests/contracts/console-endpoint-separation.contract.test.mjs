import test from 'node:test';
import assert from 'node:assert/strict';

import { getPublicRoute } from '../../services/internal-contracts/src/index.mjs';

const EXPECTED_CONSOLE_ROUTE_METADATA = {
  createTenant: {
    consoleTier: 'spa',
    consoleWorkflowId: 'WF-CON-002',
    consoleDelegationMode: 'backend_workflow',
    consoleStatusOperationIds: ['getTenantWorkflowJobStatus']
  },
  createWorkspace: {
    consoleTier: 'spa',
    consoleWorkflowId: 'WF-CON-003',
    consoleDelegationMode: 'backend_workflow',
    consoleStatusOperationIds: ['getWorkspaceWorkflowJobStatus']
  },
  createServiceAccount: {
    consoleTier: 'spa',
    consoleWorkflowId: 'WF-CON-006',
    consoleDelegationMode: 'backend_workflow',
    consoleStatusOperationIds: []
  },
  issueServiceAccountCredential: {
    consoleTier: 'spa',
    consoleWorkflowId: 'WF-CON-004',
    consoleDelegationMode: 'backend_workflow',
    consoleStatusOperationIds: []
  },
  rotateServiceAccountCredential: {
    consoleTier: 'spa',
    consoleWorkflowId: 'WF-CON-004',
    consoleDelegationMode: 'backend_workflow',
    consoleStatusOperationIds: []
  },
  revokeServiceAccountCredential: {
    consoleTier: 'spa',
    consoleWorkflowId: 'WF-CON-004',
    consoleDelegationMode: 'backend_workflow',
    consoleStatusOperationIds: []
  },
  getTenantWorkflowJobStatus: {
    consoleTier: 'spa',
    consoleWorkflowId: 'WF-CON-002',
    consoleDelegationMode: 'status_query',
    consoleStatusOperationIds: []
  },
  getWorkspaceWorkflowJobStatus: {
    consoleTier: 'spa',
    consoleWorkflowId: 'WF-CON-003',
    consoleDelegationMode: 'status_query',
    consoleStatusOperationIds: []
  }
};

test('console endpoint separation contract exposes the expected route-catalog metadata', () => {
  for (const [operationId, expected] of Object.entries(EXPECTED_CONSOLE_ROUTE_METADATA)) {
    const route = getPublicRoute(operationId);
    assert.ok(route, `missing route catalog entry for ${operationId}`);
    assert.equal(route.consoleTier, expected.consoleTier);
    assert.equal(route.consoleWorkflowId, expected.consoleWorkflowId);
    assert.equal(route.consoleDelegationMode, expected.consoleDelegationMode);
    assert.deepEqual(route.consoleStatusOperationIds, expected.consoleStatusOperationIds);
  }
});

test('route catalog discovery surface stays platform-tier and status-operation references resolve', () => {
  const routeCatalog = getPublicRoute('getRouteCatalog');
  assert.ok(routeCatalog);
  assert.equal(routeCatalog.consoleTier, 'platform');
  assert.equal(routeCatalog.consoleDiscoverySurface, true);

  for (const operationId of ['createTenant', 'createWorkspace']) {
    const route = getPublicRoute(operationId);
    for (const statusOperationId of route.consoleStatusOperationIds) {
      assert.ok(getPublicRoute(statusOperationId), `missing referenced status operation ${statusOperationId}`);
    }
  }
});
