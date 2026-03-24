import { readAuthorizationModel } from './authorization-model.mjs';
import { readDeploymentTopology } from './deployment-topology.mjs';
import { readJson } from './quality-gates.mjs';

export const DOMAIN_MODEL_PATH = 'services/internal-contracts/src/domain-model.json';
export const DOMAIN_SEED_FIXTURES_PATH = 'tests/reference/domain-seed-fixtures.json';
export const REQUIRED_DOMAIN_CONTRACT_IDS = [
  'entity_read_model',
  'entity_write_model',
  'lifecycle_event',
  'effective_capability_resolution'
];
export const REQUIRED_ENTITY_IDS = [
  'platform_user',
  'tenant',
  'workspace',
  'external_application',
  'service_account',
  'managed_resource',
  'tenant_membership',
  'workspace_membership',
  'invitation',
  'plan',
  'quota_policy',
  'deployment_profile',
  'provider_capability'
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

    if (entity.id === 'tenant_membership') {
      for (const field of ['tenantId', 'userId', 'role', 'membershipStatus']) {
        if (!entity.required_fields.includes(field)) {
          violations.push(`Domain entity tenant_membership must require ${field}.`);
        }
      }
    }

    if (entity.id === 'workspace_membership') {
      for (const field of ['tenantId', 'workspaceId', 'userId', 'role', 'membershipStatus']) {
        if (!entity.required_fields.includes(field)) {
          violations.push(`Domain entity workspace_membership must require ${field}.`);
        }
      }
    }

    if (entity.id === 'invitation') {
      for (const field of ['tenantId', 'emailHash', 'targetType', 'role', 'invitationStatus', 'expiresAt']) {
        if (!entity.required_fields.includes(field)) {
          violations.push(`Domain entity invitation must require ${field}.`);
        }
      }
    }

    if (entity.id === 'plan') {
      for (const field of ['planStatus', 'deploymentProfileId', 'quotaPolicyId']) {
        if (!entity.required_fields.includes(field)) {
          violations.push(`Domain entity plan must require ${field}.`);
        }
      }
    }

    if (entity.id === 'quota_policy') {
      for (const field of ['quotaScope', 'enforcementMode', 'defaultLimits']) {
        if (!entity.required_fields.includes(field)) {
          violations.push(`Domain entity quota_policy must require ${field}.`);
        }
      }
    }

    if (entity.id === 'deployment_profile') {
      for (const field of ['profileClass', 'supportedEnvironments', 'planeBindings']) {
        if (!entity.required_fields.includes(field)) {
          violations.push(`Domain entity deployment_profile must require ${field}.`);
        }
      }
    }

    if (entity.id === 'provider_capability') {
      for (const field of ['provider', 'capabilityKey', 'plane', 'capabilityStatus', 'allowedEnvironments']) {
        if (!entity.required_fields.includes(field)) {
          violations.push(`Domain entity provider_capability must require ${field}.`);
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
    'workspace_managed_resources',
    'tenant_tenant_memberships',
    'workspace_workspace_memberships',
    'tenant_invitations',
    'plan_quota_policies',
    'plan_deployment_profiles',
    'deployment_profile_provider_capabilities'
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

function collectGovernanceViolations(model, deploymentTopology, violations) {
  const stateMachines = model?.business_state_machines;
  if (!ensureNonEmptyArray(stateMachines)) {
    violations.push('Domain model business_state_machines must be a non-empty array.');
  } else {
    const stateMachineIds = new Set();
    for (const machine of stateMachines) {
      if (!machine?.id) {
        violations.push('Each business state machine must define id.');
        continue;
      }
      if (stateMachineIds.has(machine.id)) {
        violations.push(`Duplicate business state machine ${machine.id}.`);
      }
      stateMachineIds.add(machine.id);
      if (!ensureNonEmptyArray(machine.states)) {
        violations.push(`Business state machine ${machine.id} must define states.`);
      }
      if (!ensureNonEmptyArray(machine.allowed_transitions)) {
        violations.push(`Business state machine ${machine.id} must define allowed_transitions.`);
      }
      if (!ensureNonEmptyArray(machine.rules)) {
        violations.push(`Business state machine ${machine.id} must define rules.`);
      }
    }
  }

  const catalogs = model?.governance_catalogs ?? {};
  if (!ensureNonEmptyArray(catalogs.plans)) {
    violations.push('Domain model governance_catalogs.plans must be a non-empty array.');
  }
  if (!ensureNonEmptyArray(catalogs.quota_policies)) {
    violations.push('Domain model governance_catalogs.quota_policies must be a non-empty array.');
  }
  if (!ensureNonEmptyArray(catalogs.deployment_profiles)) {
    violations.push('Domain model governance_catalogs.deployment_profiles must be a non-empty array.');
  }
  if (!ensureNonEmptyArray(catalogs.provider_capabilities)) {
    violations.push('Domain model governance_catalogs.provider_capabilities must be a non-empty array.');
  }

  const planIds = new Set((catalogs.plans ?? []).map((plan) => plan.planId));
  const quotaPolicyIds = new Set((catalogs.quota_policies ?? []).map((policy) => policy.quotaPolicyId));
  const profileIds = new Set((catalogs.deployment_profiles ?? []).map((profile) => profile.deploymentProfileId));
  const providerCapabilityIds = new Set((catalogs.provider_capabilities ?? []).map((capability) => capability.providerCapabilityId));
  const knownEnvironments = new Set((deploymentTopology?.environment_profiles ?? []).map((entry) => entry.id));

  for (const plan of catalogs.plans ?? []) {
    if (!quotaPolicyIds.has(plan.quotaPolicyId)) {
      violations.push(`Plan ${plan.planId} references unknown quota policy ${plan.quotaPolicyId}.`);
    }
    if (!profileIds.has(plan.deploymentProfileId)) {
      violations.push(`Plan ${plan.planId} references unknown deployment profile ${plan.deploymentProfileId}.`);
    }
    if (!ensureNonEmptyArray(plan.capabilityKeys)) {
      violations.push(`Plan ${plan.planId} must define capabilityKeys.`);
    }
  }

  for (const policy of catalogs.quota_policies ?? []) {
    if (!ensureNonEmptyArray(policy.defaultLimits)) {
      violations.push(`Quota policy ${policy.quotaPolicyId} must define defaultLimits.`);
    }
  }

  for (const profile of catalogs.deployment_profiles ?? []) {
    if (!ensureNonEmptyArray(profile.supportedEnvironments)) {
      violations.push(`Deployment profile ${profile.deploymentProfileId} must define supportedEnvironments.`);
    } else {
      for (const environment of profile.supportedEnvironments) {
        if (!knownEnvironments.has(environment)) {
          violations.push(`Deployment profile ${profile.deploymentProfileId} references unknown environment ${environment}.`);
        }
      }
    }

    for (const providerCapabilityId of profile.providerCapabilityIds ?? []) {
      if (!providerCapabilityIds.has(providerCapabilityId)) {
        violations.push(
          `Deployment profile ${profile.deploymentProfileId} references unknown provider capability ${providerCapabilityId}.`
        );
      }
    }
  }

  if (!model?.effective_capability_resolution?.paths?.tenant || !model?.effective_capability_resolution?.paths?.workspace) {
    violations.push('Domain model effective_capability_resolution must define tenant and workspace paths.');
  }

  if (!ensureNonEmptyArray(model?.plan_change_scenarios)) {
    violations.push('Domain model plan_change_scenarios must be a non-empty array.');
  } else {
    for (const scenario of model.plan_change_scenarios) {
      if (!planIds.has(scenario.fromPlanId)) {
        violations.push(`Plan change scenario ${scenario.id} references unknown fromPlanId ${scenario.fromPlanId}.`);
      }
      if (!planIds.has(scenario.toPlanId)) {
        violations.push(`Plan change scenario ${scenario.id} references unknown toPlanId ${scenario.toPlanId}.`);
      }
      if (!ensureNonEmptyArray(scenario.expectedOutcome?.blockingMetrics ?? [])) {
        // allow empty blockingMetrics, but preserve array shape.
        if (!Array.isArray(scenario.expectedOutcome?.blockingMetrics)) {
          violations.push(`Plan change scenario ${scenario.id} must define expectedOutcome.blockingMetrics as an array.`);
        }
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
  const allowedPlanIds = new Set((model?.governance_catalogs?.plans ?? []).map((plan) => plan.planId));
  const allowedResourceKinds = new Set(
    (model?.entities ?? []).find((entity) => entity.id === 'managed_resource')?.supported_kinds ?? []
  );
  const placements = new Set();
  const tenantSizes = new Set();
  let hasSingleWorkspace = false;
  let hasMultiWorkspace = false;
  let hasSharedWorkspaceResource = false;

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

    if (!allowedPlanIds.has(profile.tenant.planId)) {
      violations.push(`Domain seed profile ${profile.id} references unknown tenant planId ${profile.tenant.planId}.`);
    }

    const workspaceIndex = new Map((profile.workspaces ?? []).map((workspace) => [workspace.workspaceId, workspace]));
    const applicationIndex = new Map((profile.externalApplications ?? []).map((application) => [application.applicationId, application]));
    const serviceAccountIndex = new Map((profile.serviceAccounts ?? []).map((serviceAccount) => [serviceAccount.serviceAccountId, serviceAccount]));
    const applicationIds = new Set(applicationIndex.keys());
    const serviceAccountIds = new Set(serviceAccountIndex.keys());
    const platformUserIds = new Set((profile.platformUsers ?? []).map((user) => user.userId));
    const workspaceSlugs = new Set();
    const workspaceNames = new Set();

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
      if (!workspace.slug || workspaceSlugs.has(workspace.slug)) {
        violations.push(`Domain seed workspace ${workspace.workspaceId} must define a tenant-unique slug.`);
      } else {
        workspaceSlugs.add(workspace.slug);
      }
      if (!workspace.displayName || workspaceNames.has(workspace.displayName)) {
        violations.push(`Domain seed workspace ${workspace.workspaceId} must define a tenant-unique displayName.`);
      } else {
        workspaceNames.add(workspace.displayName);
      }
      if (!workspace.iamBoundary?.keyPolicy?.secretPathPrefix) {
        violations.push(`Domain seed workspace ${workspace.workspaceId} must define iamBoundary.keyPolicy.secretPathPrefix.`);
      }
      if (!workspace.resourceInheritance?.mode || !Array.isArray(workspace.resourceInheritance?.logicalResources)) {
        violations.push(`Domain seed workspace ${workspace.workspaceId} must define resourceInheritance mode and logicalResources.`);
      }
      if (!workspace.apiSurface?.controlApiBaseUrl || !workspace.apiSurface?.applicationBaseUrlPattern) {
        violations.push(`Domain seed workspace ${workspace.workspaceId} must define apiSurface base URLs.`);
      }
    }

    for (const application of profile.externalApplications ?? []) {
      if (!workspaceIndex.has(application.workspaceId)) {
        violations.push(`Domain seed application ${application.applicationId} references unknown workspace ${application.workspaceId}.`);
      }
      if (!ensureNonEmptyArray(application.endpoints)) {
        violations.push(`Domain seed application ${application.applicationId} must define endpoints.`);
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
      if (!resource.logicalResourceKey) {
        violations.push(`Domain seed managed resource ${resource.resourceId} must define logicalResourceKey.`);
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

      const consumerWorkspaceIds = resource.consumerWorkspaceIds ?? [];
      for (const workspaceId of consumerWorkspaceIds) {
        if (!workspaceIndex.has(workspaceId)) {
          violations.push(`Domain seed managed resource ${resource.resourceId} references unknown consumer workspace ${workspaceId}.`);
        }
      }

      for (const applicationId of resource.authorizedApplicationIds ?? []) {
        const application = applicationIndex.get(applicationId);
        if (!application) {
          violations.push(`Domain seed managed resource ${resource.resourceId} references unknown authorized application ${applicationId}.`);
        } else if (!consumerWorkspaceIds.includes(application.workspaceId)) {
          violations.push(
            `Domain seed managed resource ${resource.resourceId} authorized application ${applicationId} must belong to a consumer workspace.`
          );
        }
      }

      for (const serviceAccountId of resource.authorizedServiceAccountIds ?? []) {
        const serviceAccount = serviceAccountIndex.get(serviceAccountId);
        if (!serviceAccount) {
          violations.push(`Domain seed managed resource ${resource.resourceId} references unknown authorized service account ${serviceAccountId}.`);
        } else if (!consumerWorkspaceIds.includes(serviceAccount.workspaceId)) {
          violations.push(
            `Domain seed managed resource ${resource.resourceId} authorized service account ${serviceAccountId} must belong to a consumer workspace.`
          );
        }
      }

      if (resource.sharingScope === 'tenant_shared') {
        hasSharedWorkspaceResource = true;
        if (consumerWorkspaceIds.length < 2) {
          violations.push(`Domain seed managed resource ${resource.resourceId} must expose at least two consumer workspaces when sharingScope is tenant_shared.`);
        }
      }
    }

    if (!ensureNonEmptyArray(profile.tenantMemberships)) {
      violations.push(`Domain seed profile ${profile.id} must define tenantMemberships.`);
    } else {
      for (const membership of profile.tenantMemberships) {
        if (membership.tenantId !== profile.tenant.tenantId) {
          violations.push(`Domain seed tenant membership ${membership.tenantMembershipId} must stay inside tenant ${profile.tenant.tenantId}.`);
        }
        if (!platformUserIds.has(membership.userId)) {
          violations.push(`Domain seed tenant membership ${membership.tenantMembershipId} references unknown user ${membership.userId}.`);
        }
      }
    }

    if (!ensureNonEmptyArray(profile.workspaceMemberships)) {
      violations.push(`Domain seed profile ${profile.id} must define workspaceMemberships.`);
    } else {
      for (const membership of profile.workspaceMemberships) {
        if (!workspaceIndex.has(membership.workspaceId)) {
          violations.push(
            `Domain seed workspace membership ${membership.workspaceMembershipId} references unknown workspace ${membership.workspaceId}.`
          );
        }
        if (!platformUserIds.has(membership.userId)) {
          violations.push(
            `Domain seed workspace membership ${membership.workspaceMembershipId} references unknown user ${membership.userId}.`
          );
        }
      }
    }

    if (!ensureNonEmptyArray(profile.invitations)) {
      violations.push(`Domain seed profile ${profile.id} must define invitations.`);
    } else {
      for (const invitation of profile.invitations) {
        if (invitation.tenantId !== profile.tenant.tenantId) {
          violations.push(`Domain seed invitation ${invitation.invitationId} must stay inside tenant ${profile.tenant.tenantId}.`);
        }
        if (invitation.workspaceId && !workspaceIndex.has(invitation.workspaceId)) {
          violations.push(`Domain seed invitation ${invitation.invitationId} references unknown workspace ${invitation.workspaceId}.`);
        }
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

  if (!hasSharedWorkspaceResource) {
    violations.push('Domain seed fixtures must include at least one tenant-shared managed resource across multiple workspaces.');
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
  collectGovernanceViolations(model, deploymentTopology, violations);

  if (!ensureNonEmptyArray(model?.business_invariants)) {
    violations.push('Domain model business_invariants must be a non-empty array.');
  }

  collectSeedFixtureViolations(model, seeds, deploymentTopology, violations);

  return violations;
}
