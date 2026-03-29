import { executeSaga } from '../../../../apps/control-plane/src/saga/saga-engine.mjs';

const defaultContext = {
  tenantId: 'test-tenant-a',
  workspaceId: 'ws-test-001',
  actorType: 'svc',
  actorId: 'e2e-test-runner'
};

export async function runWorkflow(workflowId, params = {}, contextOverrides = {}) {
  return executeSaga(workflowId, params, { ...defaultContext, ...contextOverrides });
}
