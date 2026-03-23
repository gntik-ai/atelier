import { readJson } from './quality-gates.mjs';

export const AUTHORIZATION_MODEL_PATH = 'services/internal-contracts/src/authorization-model.json';
export const REQUIRED_AUTHORIZATION_CONTRACT_IDS = [
  'security_context',
  'authorization_decision',
  'context_projection',
  'negative_authorization_case'
];
export const REQUIRED_AUTHORIZATION_SURFACES = [
  'control_api',
  'data_api',
  'functions_runtime',
  'event_bus',
  'object_storage'
];
export const REQUIRED_AUTHORIZATION_CONTEXT_FIELDS = [
  'actor',
  'tenant_id',
  'workspace_id',
  'plan_id',
  'scopes',
  'effective_roles',
  'correlation_id'
];
export const REQUIRED_RESOURCE_TYPES = ['tenant', 'workspace', 'database', 'bucket', 'topic', 'function', 'app'];
export const REQUIRED_ROLE_SCOPES = ['platform', 'tenant', 'workspace'];
export const REQUIRED_PROPAGATION_TARGETS = [
  'control_api_command',
  'provisioning_request',
  'adapter_call',
  'audit_record',
  'kafka_headers',
  'openwhisk_activation',
  'storage_presign_context'
];

export function readAuthorizationModel() {
  return readJson(AUTHORIZATION_MODEL_PATH);
}

function ensureNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function flattenActions(resourceActions = {}) {
  return new Set(Object.values(resourceActions).flatMap((actions) => actions ?? []));
}

export function collectAuthorizationModelViolations(model = readAuthorizationModel()) {
  const violations = [];

  if (typeof model?.version !== 'string' || model.version.length === 0) {
    violations.push('Authorization model version must be a non-empty string.');
  }

  const contracts = model?.contracts ?? {};
  for (const contractId of REQUIRED_AUTHORIZATION_CONTRACT_IDS) {
    const contract = contracts[contractId];

    if (!contract) {
      violations.push(`Authorization model must include contract ${contractId}.`);
      continue;
    }

    if (contract.version !== model.version) {
      violations.push(`Authorization contract ${contractId} version must align with authorization-model version ${model.version}.`);
    }

    if (!ensureNonEmptyArray(contract.required_fields)) {
      violations.push(`Authorization contract ${contractId} must define required_fields.`);
    }

    if (typeof contract.versioning !== 'string' || contract.versioning.length === 0) {
      violations.push(`Authorization contract ${contractId} must define versioning expectations.`);
    }

    if (!ensureNonEmptyArray(contract.error_classes)) {
      violations.push(`Authorization contract ${contractId} must define error_classes.`);
    }
  }

  const securityContext = model?.security_context ?? {};
  for (const field of REQUIRED_AUTHORIZATION_CONTEXT_FIELDS) {
    if (!(securityContext.required_fields ?? []).includes(field)) {
      violations.push(`Authorization security_context must require ${field}.`);
    }
  }

  if (!ensureNonEmptyArray(securityContext.actor_types)) {
    violations.push('Authorization security_context.actor_types must be a non-empty array.');
  }

  if (!ensureNonEmptyArray(securityContext.resolution_order)) {
    violations.push('Authorization security_context.resolution_order must be a non-empty array.');
  }

  if (!ensureNonEmptyArray(securityContext.default_denials)) {
    violations.push('Authorization security_context.default_denials must be a non-empty array.');
  }

  const roleCatalog = model?.role_catalog ?? {};
  const knownRoles = new Map();
  for (const scope of REQUIRED_ROLE_SCOPES) {
    const roles = roleCatalog[scope];

    if (!ensureNonEmptyArray(roles)) {
      violations.push(`Authorization role_catalog.${scope} must be a non-empty array.`);
      continue;
    }

    for (const role of roles) {
      if (!role?.id) {
        violations.push(`Authorization role_catalog.${scope} contains a role without a stable id.`);
        continue;
      }

      if (knownRoles.has(role.id)) {
        violations.push(`Authorization role ${role.id} must not be duplicated across catalogs.`);
      }

      knownRoles.set(role.id, scope);

      if (role.scope !== scope) {
        violations.push(`Authorization role ${role.id} must declare scope ${scope}.`);
      }

      if (typeof role.summary !== 'string' || role.summary.length === 0) {
        violations.push(`Authorization role ${role.id} must define a summary.`);
      }
    }
  }

  const enforcementSurfaces = model?.enforcement_surfaces;
  if (!ensureNonEmptyArray(enforcementSurfaces)) {
    violations.push('Authorization enforcement_surfaces must be a non-empty array.');
  }

  const surfaceIndex = new Map();
  for (const surface of enforcementSurfaces ?? []) {
    if (!surface?.id) {
      violations.push('Each authorization enforcement surface must define a stable id.');
      continue;
    }

    if (surfaceIndex.has(surface.id)) {
      violations.push(`Duplicate authorization enforcement surface ${surface.id}.`);
      continue;
    }

    surfaceIndex.set(surface.id, surface);

    if (!ensureNonEmptyArray(surface.planes)) {
      violations.push(`Authorization surface ${surface.id} must define planes.`);
    }

    if (!ensureNonEmptyArray(surface.required_context_fields)) {
      violations.push(`Authorization surface ${surface.id} must define required_context_fields.`);
    } else {
      for (const field of REQUIRED_AUTHORIZATION_CONTEXT_FIELDS) {
        if (!surface.required_context_fields.includes(field)) {
          violations.push(`Authorization surface ${surface.id} must require context field ${field}.`);
        }
      }
    }

    if (surface.decision_contract !== 'authorization_decision') {
      violations.push(`Authorization surface ${surface.id} must use authorization_decision as decision_contract.`);
    }
  }

  for (const surfaceId of REQUIRED_AUTHORIZATION_SURFACES) {
    if (!surfaceIndex.has(surfaceId)) {
      violations.push(`Authorization model must include enforcement surface ${surfaceId}.`);
    }
  }

  const resourceActions = model?.resource_actions ?? {};
  const allActions = flattenActions(resourceActions);
  for (const resourceType of REQUIRED_RESOURCE_TYPES) {
    if (!ensureNonEmptyArray(resourceActions[resourceType])) {
      violations.push(`Authorization resource_actions.${resourceType} must be a non-empty array.`);
    }
  }

  const resourceSemantics = model?.resource_semantics;
  if (!ensureNonEmptyArray(resourceSemantics)) {
    violations.push('Authorization resource_semantics must be a non-empty array.');
  }

  const resourceIndex = new Map();
  for (const resource of resourceSemantics ?? []) {
    if (!resource?.resource_type) {
      violations.push('Each authorization resource semantics entry must define resource_type.');
      continue;
    }

    if (resourceIndex.has(resource.resource_type)) {
      violations.push(`Duplicate authorization resource semantics entry ${resource.resource_type}.`);
      continue;
    }

    resourceIndex.set(resource.resource_type, resource);

    if (!['platform', 'tenant', 'workspace'].includes(resource.parent_scope)) {
      violations.push(`Authorization resource ${resource.resource_type} must use parent_scope platform, tenant, or workspace.`);
    }

    if (!ensureNonEmptyArray(resource.membership_bindings)) {
      violations.push(`Authorization resource ${resource.resource_type} must define membership_bindings.`);
    }

    if (!ensureNonEmptyArray(resource.delegable_actions)) {
      violations.push(`Authorization resource ${resource.resource_type} must define delegable_actions.`);
    } else {
      for (const action of resource.delegable_actions) {
        if (!allActions.has(action)) {
          violations.push(`Authorization resource ${resource.resource_type} references unknown delegable action ${action}.`);
        }
      }
    }

    if (!ensureNonEmptyArray(resource.forbidden_actions)) {
      violations.push(`Authorization resource ${resource.resource_type} must define forbidden_actions.`);
    }
  }

  for (const resourceType of REQUIRED_RESOURCE_TYPES) {
    if (!resourceIndex.has(resourceType)) {
      violations.push(`Authorization model must include resource semantics for ${resourceType}.`);
    }
  }

  const permissionMatrix = model?.permission_matrix ?? {};
  for (const scope of REQUIRED_ROLE_SCOPES) {
    const entries = permissionMatrix[scope];

    if (!ensureNonEmptyArray(entries)) {
      violations.push(`Authorization permission_matrix.${scope} must be a non-empty array.`);
      continue;
    }

    for (const entry of entries) {
      if (!entry?.role || !knownRoles.has(entry.role)) {
        violations.push(`Authorization permission_matrix.${scope} references an unknown role ${String(entry?.role)}.`);
        continue;
      }

      if (knownRoles.get(entry.role) !== scope) {
        violations.push(`Authorization role ${entry.role} must stay within permission_matrix.${scope}.`);
      }

      if (!Array.isArray(entry.allowed_actions)) {
        violations.push(`Authorization role ${entry.role} must define allowed_actions as an array.`);
      }

      if (!Array.isArray(entry.denied_actions)) {
        violations.push(`Authorization role ${entry.role} must define denied_actions as an array.`);
      }

      for (const action of [...(entry.allowed_actions ?? []), ...(entry.denied_actions ?? [])]) {
        if (!allActions.has(action)) {
          violations.push(`Authorization role ${entry.role} references unknown action ${action}.`);
        }
      }
    }
  }

  const propagationTargets = model?.propagation_targets;
  if (!ensureNonEmptyArray(propagationTargets)) {
    violations.push('Authorization propagation_targets must be a non-empty array.');
  }

  const targetIndex = new Map();
  for (const target of propagationTargets ?? []) {
    if (!target?.target) {
      violations.push('Each authorization propagation target must define target.');
      continue;
    }

    if (targetIndex.has(target.target)) {
      violations.push(`Duplicate authorization propagation target ${target.target}.`);
      continue;
    }

    targetIndex.set(target.target, target);

    if (!ensureNonEmptyArray(target.required_fields)) {
      violations.push(`Authorization propagation target ${target.target} must define required_fields.`);
    } else if (!target.required_fields.includes('correlation_id')) {
      violations.push(`Authorization propagation target ${target.target} must carry correlation_id.`);
    }

    if (!Array.isArray(target.redacted_fields)) {
      violations.push(`Authorization propagation target ${target.target} must define redacted_fields as an array.`);
    }

    if (typeof target.reason !== 'string' || target.reason.length === 0) {
      violations.push(`Authorization propagation target ${target.target} must define a reason.`);
    }
  }

  for (const targetId of REQUIRED_PROPAGATION_TARGETS) {
    if (!targetIndex.has(targetId)) {
      violations.push(`Authorization model must include propagation target ${targetId}.`);
    }
  }

  const negativeScenarios = model?.negative_scenarios;
  if (!ensureNonEmptyArray(negativeScenarios)) {
    violations.push('Authorization negative_scenarios must be a non-empty array.');
  } else {
    const categories = new Set();
    for (const scenario of negativeScenarios) {
      if (!scenario?.id) {
        violations.push('Each authorization negative scenario must define a stable id.');
        continue;
      }

      if (!surfaceIndex.has(scenario.surface)) {
        violations.push(`Authorization negative scenario ${scenario.id} references unknown surface ${String(scenario.surface)}.`);
      }

      if (scenario.expected_effect !== 'deny') {
        violations.push(`Authorization negative scenario ${scenario.id} must use expected_effect deny.`);
      }

      if (typeof scenario.summary !== 'string' || scenario.summary.length === 0) {
        violations.push(`Authorization negative scenario ${scenario.id} must define a summary.`);
      }

      categories.add(scenario.category);
    }

    for (const requiredCategory of ['cross_tenant', 'delegation_escalation']) {
      if (!categories.has(requiredCategory)) {
        violations.push(`Authorization negative_scenarios must include category ${requiredCategory}.`);
      }
    }
  }

  return violations;
}
