import { readAuthorizationModel } from './authorization-model.mjs';
import { readDeploymentTopology } from './deployment-topology.mjs';
import { readJson } from './quality-gates.mjs';

export const DOMAIN_MODEL_PATH = 'services/internal-contracts/src/domain-model.json';
export const DOMAIN_SEED_FIXTURES_PATH = 'tests/reference/domain-seed-fixtures.json';
export const REQUIRED_DOMAIN_CONTRACT_IDS = ['entity_read_model', 'entity_write_model', 'lifecycle_event'];
export const REQUIRED_ENTITY_IDS = [
  'platform_user',
  'tenant',
  'workspace',
  'external_application',
  'service_account',
  'managed_resource'
];
export const REQUIRED_TRANSITIONS = ['create', 'activate', 'suspend', 'soft_delete'];

export function readDomainModel() {
  return readJson(DOMAIN_MODEL_PATH);
}

export function readDomainSeedFixtures() {
  return readJson(DOMAIN_SEED_FIXTURES_PATH);
}

function ensureNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function collectContractViolations(model, violations) {
  for (const contractId of REQUIRED_DOMAIN_CONTRACT_IDS) {
    const contract = model?.contracts?.[contractId];

    if (!contract) {
      violations.push(`Domain model must include contract ${contractId}.`);
      continue;
    }

    if (contract.version !== model.version) {
      violations.push(`Domain contract ${contractId} version must align with domain-model version ${model.version}.`);
    }

    if (!ensureNonEmptyArray(contract.required_fields)) {
      violations.push(`Domain contract ${contractId} must define required_fields.`);
    }

    if (typeof contract.versioning !== 'string' || contract.versioning.length === 0) {
      violations.push(`Domain contract ${contractId} must define versioning guidance.`);
    }

    if (!ensureNonEmptyArray(contract.error_classes)) {
      violations.push(`Domain contract ${contractId} must define error_classes.`);
    }
  }
}

function collectEntityViolations(model, deploymentTopology, authorizationModel, violations) {
  const entities = model?.entities;
  if (!ensureNonEmptyArray(entities)) {
    violations.push('Domain model entities must be a non-empty array.');
    return { entityIndex: new Map(), transitionIndex: new Map() };
  }

  const baseline = model?.shared_baseline ?? {};
  const baselineStates = new Set(baseline.supported_states ?? []);
  const idPrefixes = baseline.identifier_strategy?.id_prefixes ?? {};
  const knownEnvironments = new Set((deploymentTopology?.environment_profiles ?? []).map((entry) => entry.id));
  const authorizationResourceTypes = new Set((authorizationModel?.resource_semantics ?? []).map((entry) => entry.resource_type));
  const entityIndex = new Map();
  const prefixIndex = new Map();

  for (const entity of entities) {
    if (!entity?.id) {
      violations.push('Each domain entity must define a stable id.');
      continue;
    }

    if (entityIndex.has(entity.id)) {
      violations.push(`Duplicate domain entity ${entity.id}.`);
      continue;
    }

    entityIndex.set(entity.id, entity);

    if (entity.id_prefix !== idPrefixes[entity.id]) {
      violations.push(`Domain entity ${entity.id} must use id prefix ${String(idPrefixes[entity.id])}.`);
    }

    if (prefixIndex.has(entity.id_prefix)) {
      violations.push(`Domain id prefix ${entity.id_prefix} must be unique.`);
    }
    prefixIndex.set(entity.id_prefix, entity.id);

    if (!['platform', 'tenant', 'workspace'].includes(entity.scope)) {
      violations.push(`Domain entity ${entity.id} must declare scope platform, tenant, or workspace.`);
    }

    if (typeof entity.primary_id_field !== 'string' || entity.primary_id_field.length === 0) {
      violations.push(`Domain entity ${entity.id} must define primary_id_field.`);
    }

    if (typeof entity.slug_field !== 'string' || entity.slug_field.length === 0) {
      violations.push(`Domain entity ${entity.id} must define slug_field.`);
    }

    if (!ensureNonEmptyArray(entity.required_fields)) {
      violations.push(`Domain entity ${entity.id} must define required_fields.`);
    }

    if (!ensureNonEmptyArray(entity.business_rules)) {
      violations.push(`Domain entity ${entity.id} must define business_rules.`);
    }

    if (!ensureNonEmptyArray(entity.supported_states)) {
      violations.push(`Domain entity ${entity.id} must define supported_states.`);
    } else {
      for (const state of entity.supported_states) {
        if (!baselineStates.has(state)) {
          violations.push(`Domain entity ${entity.id} references unknown state ${state}.`);
        }
      }
    }

    if (entity.parent_entity_type && !REQUIRED_ENTITY_IDS.includes(entity.parent_entity_type)) {
      violations.push(`Domain entity ${entity.id} references unknown parent_entity_type ${entity.parent_entity_type}.`);
    }

    const openapi = entity.openapi ?? {};
    for (const field of ['read_schema', 'write_schema', 'read_path', 'write_path']) {
      if (typeof openapi[field] !== 'string' || openapi[field].length === 0) {
        violations.push(`Domain entity ${entity.id} must define openapi.${field}.`);
      }
    }

    if (entity.id === 'platform_user' && !entity.required_fields.includes('identitySubject')) {
      violations.push('Domain entity platform_user must require identitySubject.');
    }

    if (entity.id === 'tenant' && !entity.required_fields.includes('placement')) {
      violations.push('Domain entity tenant must require placement.');
    }

    if (entity.id === 'workspace') {
      if (!entity.required_fields.includes('tenantId')) {
        violations.push('Domain entity workspace must require tenantId.');
      }
      if (!entity.required_fields.includes('environment')) {
        violations.push('Domain entity workspace must require environment.');
      }
      for (const environment of ['dev', 'sandbox', 'staging', 'prod']) {
        if (!knownEnvironments.has(environment)) {
          violations.push(`Deployment topology must expose workspace environment ${environment}.`);
        }
      }
    }

    if (['external_application', 'service_account', 'managed_resource'].includes(entity.id)) {
      for (const field of ['tenantId', 'workspaceId']) {
        if (!entity.required_fields.includes(field)) {
          violations.push(`Domain entity ${entity.id} must require ${field}.`);
        }
      }
    }

    if (entity.id === 'managed_resource') {
      if (!ensureNonEmptyArray(entity.supported_kinds)) {
        violations.push('Domain entity managed_resource must define supported_kinds.');
      } else {
        for (const kind of entity.supported_kinds) {
          if (!authorizationResourceTypes.has(kind)) {
            violations.push(`Managed resource kind ${kind} must align with the authorization model.`);
          }
        }
      }
    }
  }

  for (const entityId of REQUIRED_ENTITY_IDS) {
    if (!entityIndex.has(entityId)) {
      violations.push(`Domain model must include entity ${entityId}.`);
    }
  }

  return { entityIndex };
}

function collectRelationshipViolations(model, entityIndex, violations) {
  const relationships = model?.relationships;
  if (!ensureNonEmptyArray(relationships)) {
    violations.push('Domain model relationships must be a non-empty array.');
    return;
  }

  const relationshipIds = new Set();
  for (const relationship of relationships) {
    if (!relationship?.id) {
      violations.push('Each domain relationship must define a stable id.');
      continue;
    }

    if (relationshipIds.has(relationship.id)) {
      violations.push(`Duplicate domain relationship ${relationship.id}.`);
      continue;
    }
    relationshipIds.add(relationship.id);

    if (!entityIndex.has(relationship.source_entity)) {
      violations.push(`Domain relationship ${relationship.id} references unknown source_entity ${relationship.source_entity}.`);
    }

    if (!entityIndex.has(relationship.target_entity)) {
      violations.push(`Domain relationship ${relationship.id} references unknown target_entity ${relationship.target_entity}.`);
    }

    if (!['one_to_many', 'many_to_many', 'one_to_one'].includes(relationship.cardinality)) {
      violations.push(`Domain relationship ${relationship.id} must define a supported cardinality.`);
    }

    if (!ensureNonEmptyArray(relationship.integrity_rules)) {
      violations.push(`Domain relationship ${relationship.id} must define integrity_rules.`);
    }
  }

  for (const relationshipId of [
    'platform_user_tenant_membership',
    'platform_user_workspace_membership',
    'tenant_workspaces',
    'workspace_external_applications',
    'workspace_service_accounts',
    'workspace_managed_resources'
  ]) {
    if (!relationshipIds.has(relationshipId)) {
      violations.push(`Domain model must include relationship ${relationshipId}.`);
    }
  }
}

function collectLifecycleViolations(model, entityIndex, violations) {
  const transitions = model?.lifecycle_transitions;
  if (!ensureNonEmptyArray(transitions)) {
    violations.push('Domain model lifecycle_transitions must be a non-empty array.');
  }

  const transitionIds = new Set((transitions ?? []).map((transition) => transition?.id));
  for (const transitionId of REQUIRED_TRANSITIONS) {
    if (!transitionIds.has(transitionId)) {
      violations.push(`Domain model must include lifecycle transition ${transitionId}.`);
    }
  }

  const events = model?.lifecycle_events;
  if (!ensureNonEmptyArray(events)) {
    violations.push('Domain model lifecycle_events must be a non-empty array.');
    return;
  }

  const eventKeys = new Set();
  for (const event of events) {
    if (!entityIndex.has(event?.entity_type)) {
      violations.push(`Lifecycle event ${String(event?.event_type)} references unknown entity_type ${String(event?.entity_type)}.`);
    }

    if (!transitionIds.has(event?.transition)) {
      violations.push(`Lifecycle event ${String(event?.event_type)} references unknown transition ${String(event?.transition)}.`);
    }

    const eventKey = `${event?.entity_type}:${event?.transition}`;
    if (eventKeys.has(eventKey)) {
      violations.push(`Lifecycle event coverage must not duplicate ${eventKey}.`);
    }
    eventKeys.add(eventKey);

    if (typeof event?.event_type !== 'string' || !event.event_type.startsWith(`${event.entity_type}.`)) {
      violations.push(`Lifecycle event ${String(event?.event_type)} must use the <entity>.<transition> naming family.`);
    }
  }

  for (const entityId of entityIndex.keys()) {
    for (const transitionId of REQUIRED_TRANSITIONS) {
      if (!eventKeys.has(`${entityId}:${transitionId}`)) {
        violations.push(`Lifecycle coverage missing for ${entityId}:${transitionId}.`);
      }
    }
  }
}

function collectSeedFixtureViolations(model, seeds, deploymentTopology, violations) {
  if (seeds?.version !== model.version) {
    violations.push(`Domain seed fixtures version must align with domain-model version ${model.version}.`);
  }

  const profiles = seeds?.profiles;
  if (!ensureNonEmptyArray(profiles)) {
    violations.push('Domain seed fixtures profiles must be a non-empty array.');
    return;
  }

  const allowedEnvironments = new Set((deploymentTopology?.environment_profiles ?? []).map((entry) => entry.id));
  const allowedResourceKinds = new Set(
    (model?.entities ?? []).find((entity) => entity.id === 'managed_resource')?.supported_kinds ?? []
  );
  const placements = new Set();
  const tenantSizes = new Set();
  let hasSingleWorkspace = false;
  let hasMultiWorkspace = false;

  for (const profile of profiles) {
    if (!profile?.id) {
      violations.push('Each domain seed profile must define id.');
      continue;
    }

    if (!profile?.tenant?.tenantId) {
      violations.push(`Domain seed profile ${profile.id} must define tenant.tenantId.`);
      continue;
    }

    placements.add(profile.tenant.placement);
    tenantSizes.add(profile.tenant_size);
    hasSingleWorkspace ||= profile.workspace_count === 1;
    hasMultiWorkspace ||= profile.workspace_count >= 3;

    const workspaceIndex = new Map((profile.workspaces ?? []).map((workspace) => [workspace.workspaceId, workspace]));
    const applicationIds = new Set((profile.externalApplications ?? []).map((application) => application.applicationId));
    const serviceAccountIds = new Set((profile.serviceAccounts ?? []).map((serviceAccount) => serviceAccount.serviceAccountId));

    if (!Array.isArray(profile.workspaces) || profile.workspaces.length !== profile.workspace_count) {
      violations.push(`Domain seed profile ${profile.id} workspace_count must match the number of workspaces.`);
    }

    for (const workspace of profile.workspaces ?? []) {
      if (workspace.tenantId !== profile.tenant.tenantId) {
        violations.push(`Domain seed workspace ${workspace.workspaceId} must stay inside tenant ${profile.tenant.tenantId}.`);
      }
      if (!allowedEnvironments.has(workspace.environment)) {
        violations.push(`Domain seed workspace ${workspace.workspaceId} uses unknown environment ${workspace.environment}.`);
      }
    }

    for (const application of profile.externalApplications ?? []) {
      if (!workspaceIndex.has(application.workspaceId)) {
        violations.push(`Domain seed application ${application.applicationId} references unknown workspace ${application.workspaceId}.`);
      }
    }

    for (const serviceAccount of profile.serviceAccounts ?? []) {
      if (!workspaceIndex.has(serviceAccount.workspaceId)) {
        violations.push(
          `Domain seed service account ${serviceAccount.serviceAccountId} references unknown workspace ${serviceAccount.workspaceId}.`
        );
      }
      if (!ensureNonEmptyArray(serviceAccount.roleBindings)) {
        violations.push(`Domain seed service account ${serviceAccount.serviceAccountId} must define roleBindings.`);
      }
    }

    for (const resource of profile.managedResources ?? []) {
      if (!workspaceIndex.has(resource.workspaceId)) {
        violations.push(`Domain seed managed resource ${resource.resourceId} references unknown workspace ${resource.workspaceId}.`);
      }
      if (!allowedResourceKinds.has(resource.kind)) {
        violations.push(`Domain seed managed resource ${resource.resourceId} uses unsupported kind ${resource.kind}.`);
      }
      if (resource.applicationId && !applicationIds.has(resource.applicationId)) {
        violations.push(
          `Domain seed managed resource ${resource.resourceId} references unknown application ${resource.applicationId}.`
        );
      }
      if (resource.serviceAccountId && !serviceAccountIds.has(resource.serviceAccountId)) {
        violations.push(
          `Domain seed managed resource ${resource.resourceId} references unknown service account ${resource.serviceAccountId}.`
        );
      }
    }
  }

  if (!placements.has('shared_schema')) {
    violations.push('Domain seed fixtures must include at least one shared_schema tenant profile.');
  }

  if (!placements.has('dedicated_database')) {
    violations.push('Domain seed fixtures must include at least one dedicated_database tenant profile.');
  }

  for (const size of ['starter', 'growth', 'enterprise']) {
    if (!tenantSizes.has(size)) {
      violations.push(`Domain seed fixtures must include a ${size} tenant_size profile.`);
    }
  }

  if (!hasSingleWorkspace) {
    violations.push('Domain seed fixtures must include a single-workspace profile.');
  }

  if (!hasMultiWorkspace) {
    violations.push('Domain seed fixtures must include a multi-workspace profile.');
  }
}

export function collectDomainModelViolations(
  model = readDomainModel(),
  seeds = readDomainSeedFixtures(),
  deploymentTopology = readDeploymentTopology(),
  authorizationModel = readAuthorizationModel()
) {
  const violations = [];

  if (typeof model?.version !== 'string' || model.version.length === 0) {
    violations.push('Domain model version must be a non-empty string.');
  }

  if (typeof model?.system !== 'string' || model.system.length === 0) {
    violations.push('Domain model system must be a non-empty string.');
  }

  if (typeof model?.shared_baseline?.identifier_strategy?.slug_pattern !== 'string') {
    violations.push('Domain model shared_baseline.identifier_strategy.slug_pattern must be defined.');
  }

  if (!ensureNonEmptyArray(model?.shared_baseline?.supported_states)) {
    violations.push('Domain model shared_baseline.supported_states must be a non-empty array.');
  }

  if (!ensureNonEmptyArray(model?.shared_baseline?.integrity_rules)) {
    violations.push('Domain model shared_baseline.integrity_rules must be a non-empty array.');
  }

  collectContractViolations(model, violations);
  const { entityIndex } = collectEntityViolations(model, deploymentTopology, authorizationModel, violations);
  collectRelationshipViolations(model, entityIndex, violations);
  collectLifecycleViolations(model, entityIndex, violations);

  if (!ensureNonEmptyArray(model?.business_invariants)) {
    violations.push('Domain model business_invariants must be a non-empty array.');
  }

  collectSeedFixtureViolations(model, seeds, deploymentTopology, violations);

  return violations;
}
