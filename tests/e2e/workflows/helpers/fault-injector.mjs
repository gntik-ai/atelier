import {
  __resetWorkflowDependenciesForTest as resetWF002Deps,
  __setWorkflowDependenciesForTest as setWF002Deps
} from '../../../../apps/control-plane/src/workflows/wf-con-002-tenant-provisioning.mjs';
import {
  __resetWorkflowDependenciesForTest as resetWF003Deps,
  __setWorkflowDependenciesForTest as setWF003Deps
} from '../../../../apps/control-plane/src/workflows/wf-con-003-workspace-creation.mjs';
import {
  __resetWorkflowDependenciesForTest as resetWF004Deps,
  __setWorkflowDependenciesForTest as setWF004Deps
} from '../../../../apps/control-plane/src/workflows/wf-con-004-credential-generation.mjs';
import { sagaDefinitions } from '../../../../apps/control-plane/src/saga/saga-definitions.mjs';

const workflowDependencyMap = {
  'WF-CON-002': {
    setters: { set: setWF002Deps, reset: resetWF002Deps },
    steps: new Map([
      [1, 'createRealm'],
      [2, 'writeTenantRecord'],
      [3, 'createTopicNamespace'],
      [4, 'registerApisixRoutes']
    ])
  },
  'WF-CON-003': {
    setters: { set: setWF003Deps, reset: resetWF003Deps },
    steps: new Map([
      [1, 'createClient'],
      [2, 'writeWorkspaceRecord'],
      [3, 'provisionWorkspaceStorageBoundary']
    ])
  },
  'WF-CON-004': {
    setters: { set: setWF004Deps, reset: resetWF004Deps },
    steps: new Map([
      [1, 'generateCredential'],
      [2, 'registerGatewayCredential'],
      [3, 'writeCredentialMetadata']
    ])
  }
};

function makeInjectedError(errorCode = 'INJECTED_FAULT', message = errorCode) {
  const error = new Error(message);
  error.code = errorCode;
  return error;
}

export function injectStepFailure(workflowId, stepOrdinal, opts = {}) {
  const config = workflowDependencyMap[workflowId];
  if (!config) {
    throw new Error(`Unsupported workflowId: ${workflowId}`);
  }

  const dependencyKey = config.steps.get(stepOrdinal);
  if (!dependencyKey) {
    throw new Error(`Unsupported step ordinal ${stepOrdinal} for ${workflowId}`);
  }

  const errorCode = opts.errorCode ?? 'INJECTED_FAULT';
  const retryUntil = Number.isInteger(opts.retryUntil) ? opts.retryUntil : 0;
  let attempts = 0;

  config.setters.set({
    [dependencyKey]: async (...args) => {
      attempts += 1;
      if (retryUntil > 0 && attempts > retryUntil) {
        return { injected: 'recovered', attempts, argsCount: args.length };
      }
      throw makeInjectedError(errorCode, `${workflowId}:${dependencyKey}:attempt-${attempts}`);
    }
  });

  return {
    restore() {
      config.setters.reset();
    }
  };
}

export function restoreWorkflow(workflowId) {
  const config = workflowDependencyMap[workflowId];
  if (!config) {
    throw new Error(`Unsupported workflowId: ${workflowId}`);
  }
  config.setters.reset();
}

export function injectSagaStepFailure(workflowId, stepKey, opts = {}) {
  const definition = sagaDefinitions.get(workflowId);
  if (!definition) {
    throw new Error(`Workflow ${workflowId} not found in sagaDefinitions`);
  }

  const step = definition.steps.find((candidate) => candidate.key === stepKey);
  if (!step) {
    throw new Error(`Step ${stepKey} not found for ${workflowId}`);
  }

  const errorCode = opts.errorCode ?? 'INJECTED_FAULT';
  const failOnAttempt = Number.isInteger(opts.failOnAttempt) ? opts.failOnAttempt : 1;
  const compensationFailOnAttempt = Number.isInteger(opts.compensationFailOnAttempt)
    ? opts.compensationFailOnAttempt
    : null;
  const compensationRetryUntil = Number.isInteger(opts.compensationRetryUntil)
    ? opts.compensationRetryUntil
    : null;

  const originalForward = step.forward;
  const originalCompensate = step.compensate;
  let forwardAttempts = 0;
  let compensateAttempts = 0;

  step.forward = async (...args) => {
    forwardAttempts += 1;
    if (forwardAttempts === failOnAttempt) {
      throw makeInjectedError(errorCode, `${workflowId}:${stepKey}:forward:${forwardAttempts}`);
    }
    return originalForward(...args);
  };

  if (compensationFailOnAttempt !== null || compensationRetryUntil !== null) {
    step.compensate = async (...args) => {
      compensateAttempts += 1;
      const shouldFailThisAttempt = compensationFailOnAttempt !== null && compensateAttempts >= compensationFailOnAttempt;
      const shouldRecover = compensationRetryUntil !== null && compensateAttempts > compensationRetryUntil;
      if (shouldFailThisAttempt && !shouldRecover) {
        throw makeInjectedError(errorCode, `${workflowId}:${stepKey}:compensate:${compensateAttempts}`);
      }
      return originalCompensate(...args);
    };
  }

  return {
    restore() {
      step.forward = originalForward;
      step.compensate = originalCompensate;
    },
    get attempts() {
      return { forward: forwardAttempts, compensate: compensateAttempts };
    }
  };
}
