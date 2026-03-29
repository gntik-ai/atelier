class WorkflowNotFoundError extends Error {
  constructor(workflowId) {
    super(`Workflow not found: ${workflowId}`);
    this.code = 'WORKFLOW_NOT_FOUND';
    this.workflowId = workflowId;
  }
}

const WORKFLOW_REGISTRY = new Map([
  ['WF-CON-001', () => import('./wf-con-001-user-approval.mjs')],
  ['WF-CON-002', () => import('./wf-con-002-tenant-provisioning.mjs')],
  ['WF-CON-003', () => import('./wf-con-003-workspace-creation.mjs')],
  ['WF-CON-004', () => import('./wf-con-004-credential-generation.mjs')],
  ['WF-CON-006', () => import('./wf-con-006-service-account.mjs')]
]);

export function registerWorkflow(workflowId, handlerImport) {
  WORKFLOW_REGISTRY.set(workflowId, handlerImport);
}

export async function resolveWorkflowHandler(workflowId) {
  if (!WORKFLOW_REGISTRY.has(workflowId)) {
    if (workflowId === 'WF-CON-005') {
      return { notImplemented: true };
    }
    throw new WorkflowNotFoundError(workflowId);
  }

  return (await WORKFLOW_REGISTRY.get(workflowId)()).default;
}

export { WorkflowNotFoundError };
