import { getPublicRoute } from '../../../services/internal-contracts/src/index.mjs';

export const WEB_ACTION_VISIBILITY_STATES = Object.freeze(['public', 'private']);
export const IMPORT_ERROR_CODES = Object.freeze({
  COLLISION: 'IMPORT_COLLISION',
  POLICY_CONFLICT: 'IMPORT_POLICY_CONFLICT',
  SCOPE_VIOLATION: 'IMPORT_SCOPE_VIOLATION',
  UNSUPPORTED_BUNDLE: 'IMPORT_UNSUPPORTED_BUNDLE'
});

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeRef(ref = {}) {
  return {
    tenantId: ref.tenantId,
    workspaceId: ref.workspaceId,
    resourceType: ref.resourceType,
    name: ref.name ?? ref.actionName ?? ref.packageName,
    packageName: ref.packageName,
    actionName: ref.actionName,
    visibility: ref.visibility
  };
}

function isSupportedVisibility(visibility) {
  return WEB_ACTION_VISIBILITY_STATES.includes(visibility);
}

export function buildScopeValidatedExportRequest(context = {}, resourceRef = {}) {
  invariant(context.tenantId, 'tenantId is required for function definition export.');
  invariant(context.workspaceId, 'workspaceId is required for function definition export.');
  invariant(context.correlationId, 'correlationId is required for function definition export.');

  const normalized = normalizeRef(resourceRef);
  const requestedTenantId = normalized.tenantId ?? context.tenantId;
  const requestedWorkspaceId = normalized.workspaceId ?? context.workspaceId;

  if (requestedTenantId !== context.tenantId) {
    throw new Error('function definition export must stay within the caller tenant scope.');
  }

  if (requestedWorkspaceId !== context.workspaceId) {
    throw new Error('function definition export must stay within the caller workspace scope.');
  }

  return {
    actor: context.actor,
    actorType: context.actorType ?? 'human_user',
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    correlationId: context.correlationId,
    bundleVersion: resourceRef.bundleVersion ?? '2026-03-27',
    resourceRef: {
      ...normalized,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId
    }
  };
}

export function buildScopeValidatedImportRequest(context = {}, bundle = {}) {
  invariant(context.tenantId, 'tenantId is required for function definition import.');
  invariant(context.workspaceId, 'workspaceId is required for function definition import.');
  invariant(context.correlationId, 'correlationId is required for function definition import.');

  const bundleTenantId = bundle.tenantId ?? bundle.scope?.tenantId ?? context.tenantId;
  const bundleWorkspaceId = bundle.workspaceId ?? bundle.scope?.workspaceId ?? context.workspaceId;

  if (bundleTenantId !== context.tenantId) {
    throw new Error('function definition import must stay within the caller tenant scope.');
  }

  if (bundleWorkspaceId !== context.workspaceId) {
    throw new Error('function definition import must stay within the caller workspace scope.');
  }

  return {
    actor: context.actor,
    actorType: context.actorType ?? 'human_user',
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    correlationId: context.correlationId,
    bundleVersion: bundle.bundleVersion ?? '2026-03-27',
    importOperation: bundle.importOperation ?? 'apply',
    bundle: {
      ...bundle,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      scope: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId
      }
    }
  };
}

export function validateImportBundle(bundle = {}, context = {}) {
  const violations = [];
  const resources = Array.isArray(bundle.resources) ? bundle.resources : [];
  const existingNames = new Set(context.existingNames ?? []);

  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return {
      valid: false,
      code: IMPORT_ERROR_CODES.UNSUPPORTED_BUNDLE,
      violations: ['bundle must be an object.']
    };
  }

  if (!bundle.bundleVersion) {
    violations.push('bundleVersion is required.');
  }

  for (const resource of resources) {
    const normalized = normalizeRef(resource);
    const resourceTenantId = normalized.tenantId ?? bundle.tenantId ?? bundle.scope?.tenantId ?? context.tenantId;
    const resourceWorkspaceId = normalized.workspaceId ?? bundle.workspaceId ?? bundle.scope?.workspaceId ?? context.workspaceId;

    if (context.tenantId && resourceTenantId && resourceTenantId !== context.tenantId) {
      return {
        valid: false,
        code: IMPORT_ERROR_CODES.SCOPE_VIOLATION,
        violations: ['import bundle references a resource outside the caller tenant scope.']
      };
    }

    if (context.workspaceId && resourceWorkspaceId && resourceWorkspaceId !== context.workspaceId) {
      return {
        valid: false,
        code: IMPORT_ERROR_CODES.SCOPE_VIOLATION,
        violations: ['import bundle references a resource outside the caller workspace scope.']
      };
    }

    if (normalized.name && existingNames.has(normalized.name)) {
      return {
        valid: false,
        code: IMPORT_ERROR_CODES.COLLISION,
        violations: [`${normalized.name} already exists in the target workspace.`]
      };
    }

    if (resourceTypeHasWebActions(normalized.resourceType)) {
      const visibility = normalized.visibility ?? resource.webAction?.visibility;
      if (visibility && !isSupportedVisibility(visibility)) {
        return {
          valid: false,
          code: IMPORT_ERROR_CODES.POLICY_CONFLICT,
          violations: [`web action visibility ${visibility} is not supported for governed imports.`]
        };
      }
    }
  }

  if (violations.length > 0) {
    return {
      valid: false,
      code: IMPORT_ERROR_CODES.UNSUPPORTED_BUNDLE,
      violations
    };
  }

  return {
    valid: true,
    code: null,
    violations: []
  };
}

function resourceTypeHasWebActions(resourceType) {
  return ['function_action', 'action', 'function_definition_export', 'function_definition_import'].includes(resourceType);
}

export function buildImportErrorResponse(code, correlationId, resource = {}) {
  return {
    status: code === IMPORT_ERROR_CODES.COLLISION ? 409 : 422,
    code: `GW_${code}`,
    message: code,
    detail: {
      reason: code,
      violations: []
    },
    requestId: 'req_import_validation',
    correlationId,
    timestamp: '2026-03-27T00:00:00Z',
    resource: {
      path: resource.path ?? '/v1/functions/workspaces/{workspaceId}/definitions/import',
      type: resource.type ?? 'function_definition_import',
      id: resource.id
    },
    retryable: false
  };
}

export function listFunctionImportExportRoutes() {
  return [
    getPublicRoute('exportFunctionDefinition'),
    getPublicRoute('exportFunctionPackageDefinition'),
    getPublicRoute('importFunctionDefinition'),
    getPublicRoute('importFunctionPackageDefinition')
  ].filter(Boolean);
}
