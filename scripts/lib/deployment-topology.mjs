import { existsSync } from 'node:fs';

import { OPENAPI_PATH, readJson, readYaml, resolveParameters } from './quality-gates.mjs';

export const DEPLOYMENT_TOPOLOGY_PATH = 'services/internal-contracts/src/deployment-topology.json';
export const DEPLOYMENT_SMOKE_MATRIX_PATH = 'tests/reference/deployment-smoke-matrix.yaml';
export const BASE_VALUES_PATH = 'charts/in-falcone/values.yaml';
export const ENVIRONMENT_VALUES = {
  dev: 'charts/in-falcone/values/dev.yaml',
  sandbox: 'charts/in-falcone/values/sandbox.yaml',
  staging: 'charts/in-falcone/values/staging.yaml',
  prod: 'charts/in-falcone/values/prod.yaml'
};
export const PLATFORM_VALUES = {
  kubernetes: 'charts/in-falcone/values/platform-kubernetes.yaml',
  openshift: 'charts/in-falcone/values/platform-openshift.yaml'
};

const REQUIRED_ENVIRONMENTS = ['dev', 'sandbox', 'staging', 'prod'];
const REQUIRED_PLATFORMS = ['kubernetes', 'openshift'];
const REQUIRED_CONTRACTS = [
  'deployment_profile_descriptor',
  'public_endpoint_descriptor',
  'promotion_plan_descriptor',
  'smoke_assertion_descriptor'
];
const REQUIRED_PUBLIC_SURFACES = ['api', 'console', 'identity', 'realtime'];
const REQUIRED_ROUTE_PREFIXES = {
  control_plane: '/control-plane',
  identity: '/auth',
  realtime: '/realtime',
  console: '/'
};
const REQUIRED_HELM_VALUE_LAYERS = ['common', 'environment', 'customer', 'platform', 'airgap', 'localOverride'];
const OPTIONAL_HELM_VALUE_LAYERS = ['profile'];
const REQUIRED_COMPONENT_ALIASES = [
  'apisix',
  'keycloak',
  'postgresql',
  'mongodb',
  'kafka',
  'openwhisk',
  'storage',
  'observability',
  'controlPlane',
  'webConsole'
];
const REQUIRED_DEPLOYMENT_PROFILES = ['all-in-one', 'standard', 'ha'];
const SUPPORTED_TLS_MODES = ['clusterManaged', 'external'];
const EXPECTED_UPGRADE_GUARDRAILS = {
  in_place_supported: true,
  values_key: 'deployment.upgrade.currentVersion',
  supported_previous_versions: ['0.2.0'],
  default_strategy: 'rolling'
};
const REQUIRED_BOOTSTRAP_SECRET_STRATEGIES = ['kubernetesSecret', 'env', 'externalRef'];
const REQUIRED_BOOTSTRAP_ONE_SHOT_RESOURCES = ['superadmin', 'platform_realm', 'governance_catalog', 'internal_namespaces'];
const REQUIRED_BOOTSTRAP_RECONCILE_RESOURCES = ['apisix_routes', 'bootstrap_payload_config'];
const REQUIRED_BOOTSTRAP_CORE_ROUTES = ['control-plane', 'identity', 'realtime', 'console', 'health'];

export function readDeploymentTopology() {
  return readJson(DEPLOYMENT_TOPOLOGY_PATH);
}

export function readDeploymentSmokeMatrix() {
  return readYaml(DEPLOYMENT_SMOKE_MATRIX_PATH);
}

function readValuesFile(filePath) {
  return readYaml(filePath);
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override ?? base;
  }

  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override ?? base;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = key in merged ? deepMerge(merged[key], value) : value;
  }
  return merged;
}

export function resolveValues(environmentId, platformId) {
  const base = readValuesFile(BASE_VALUES_PATH);
  const environment = readValuesFile(ENVIRONMENT_VALUES[environmentId]);
  const platform = readValuesFile(PLATFORM_VALUES[platformId]);
  return deepMerge(deepMerge(base, environment), platform);
}

function collectTopologyContractViolations(topology) {
  const violations = [];

  if (typeof topology?.version !== 'string' || topology.version.length === 0) {
    violations.push('Deployment topology version must be a non-empty string.');
  }

  for (const contractId of REQUIRED_CONTRACTS) {
    const contract = topology?.contracts?.[contractId];
    if (!contract) {
      violations.push(`Deployment topology must define contract ${contractId}.`);
      continue;
    }

    if (contract.version !== topology.version) {
      violations.push(`Deployment contract ${contractId} version must align with topology version ${topology.version}.`);
    }

    if (!Array.isArray(contract.required_fields) || contract.required_fields.length === 0) {
      violations.push(`Deployment contract ${contractId} must define required_fields.`);
    }

    if (typeof contract.versioning !== 'string' || contract.versioning.length === 0) {
      violations.push(`Deployment contract ${contractId} must define versioning guidance.`);
    }

    if (!Array.isArray(contract.error_classes) || contract.error_classes.length === 0) {
      violations.push(`Deployment contract ${contractId} must define error_classes.`);
    }
  }

  if (topology?.public_surface?.root_domain !== 'in-falcone.example.com') {
    violations.push('Deployment topology public_surface.root_domain must be in-falcone.example.com.');
  }

  for (const [key, expected] of Object.entries(REQUIRED_ROUTE_PREFIXES)) {
    if (topology?.public_surface?.route_prefixes?.[key] !== expected) {
      violations.push(`Deployment topology route prefix ${key} must be ${expected}.`);
    }
  }

  const optionalEnvironments = topology?.public_surface?.optional_workspace_subdomain?.allowed_environments ?? [];
  for (const environmentId of optionalEnvironments) {
    if (!REQUIRED_ENVIRONMENTS.includes(environmentId)) {
      violations.push(`Optional workspace subdomain references unknown environment ${environmentId}.`);
    }
  }

  const environments = topology?.environment_profiles ?? [];
  const environmentIds = environments.map((profile) => profile?.id);
  for (const environmentId of REQUIRED_ENVIRONMENTS) {
    if (!environmentIds.includes(environmentId)) {
      violations.push(`Deployment topology must include environment profile ${environmentId}.`);
    }
  }

  for (const profile of environments) {
    if (!profile?.id) {
      violations.push('Each environment profile must define id.');
      continue;
    }

    for (const surface of REQUIRED_PUBLIC_SURFACES) {
      const hostname = profile?.hostnames?.[surface];
      if (typeof hostname !== 'string' || hostname.length === 0) {
        violations.push(`Environment profile ${profile.id} must define hostname for ${surface}.`);
      }
    }

    const operationalProfile = profile?.operational_profile;
    for (const key of ['log_level', 'debug_headers', 'passthrough_mode', 'demo_data', 'quota_profile']) {
      if (!(key in (operationalProfile ?? {}))) {
        violations.push(`Environment profile ${profile.id} must define operational_profile.${key}.`);
      }
    }

    const topologyFields = profile?.topology ?? {};
    for (const key of ['cluster_mode', 'region_mode', 'cluster_ref', 'region_ref']) {
      if (typeof topologyFields?.[key] !== 'string' || topologyFields[key].length === 0) {
        violations.push(`Environment profile ${profile.id} must define topology.${key}.`);
      }
    }
  }

  if (JSON.stringify(topology?.promotion_strategy?.canonical_path) !== JSON.stringify(['dev', 'staging', 'prod'])) {
    violations.push('Promotion strategy canonical_path must be [dev, staging, prod].');
  }

  if (topology?.promotion_strategy?.sandbox_source !== 'prod') {
    violations.push('Promotion strategy sandbox_source must be prod.');
  }

  if (JSON.stringify(topology?.configuration_policy?.helm_value_layers ?? []) !== JSON.stringify(REQUIRED_HELM_VALUE_LAYERS)) {
    violations.push(
      `Deployment topology helm_value_layers must equal ${REQUIRED_HELM_VALUE_LAYERS.join(', ')}.`
    );
  }

  if (JSON.stringify(topology?.configuration_policy?.optional_helm_value_layers ?? []) !== JSON.stringify(OPTIONAL_HELM_VALUE_LAYERS)) {
    violations.push(
      `Deployment topology optional_helm_value_layers must equal ${OPTIONAL_HELM_VALUE_LAYERS.join(', ')}.`
    );
  }

  if (!(topology?.configuration_policy?.secret_rules ?? []).some((rule) => rule.includes('Bootstrap credentials resolve'))) {
    violations.push('Deployment topology configuration_policy.secret_rules must document bootstrap credential resolution.');
  }

  if (topology?.packaging_guidance?.umbrella_chart !== 'charts/in-falcone') {
    violations.push('Deployment topology packaging_guidance.umbrella_chart must be charts/in-falcone.');
  }

  if (topology?.packaging_guidance?.component_wrapper_chart !== 'charts/in-falcone/charts/component-wrapper') {
    violations.push(
      'Deployment topology packaging_guidance.component_wrapper_chart must be charts/in-falcone/charts/component-wrapper.'
    );
  }

  if (JSON.stringify(topology?.packaging_guidance?.component_aliases ?? []) !== JSON.stringify(REQUIRED_COMPONENT_ALIASES)) {
    violations.push('Deployment topology packaging_guidance.component_aliases must match the required component aliases.');
  }

  if (JSON.stringify(topology?.packaging_guidance?.deployment_profiles ?? []) !== JSON.stringify(REQUIRED_DEPLOYMENT_PROFILES)) {
    violations.push('Deployment topology packaging_guidance.deployment_profiles must match the recommended deployment profiles.');
  }

  if (topology?.packaging_guidance?.profile_values_path !== 'charts/in-falcone/values/profiles/{profile}.yaml') {
    violations.push('Deployment topology packaging_guidance.profile_values_path must point to charts/in-falcone/values/profiles/{profile}.yaml.');
  }

  const supportedInstallModes = topology?.packaging_guidance?.supported_install_modes ?? [];
  for (const mode of ['umbrella', 'component_only', 'external_dependency']) {
    if (!supportedInstallModes.includes(mode)) {
      violations.push(`Deployment topology packaging guidance must include install mode ${mode}.`);
    }
  }

  for (const platformId of REQUIRED_PLATFORMS) {
    const platform = topology?.platform_matrix?.[platformId];
    if (!platform) {
      violations.push(`Deployment topology must define platform ${platformId}.`);
      continue;
    }

    if (!Array.isArray(platform.base_resources) || platform.base_resources.length < 5) {
      violations.push(`Platform ${platformId} must define the full base_resources set.`);
    }
  }

  if (JSON.stringify(topology?.exposure_matrix?.supported_tls_modes ?? []) !== JSON.stringify(SUPPORTED_TLS_MODES)) {
    violations.push('Deployment topology exposure_matrix.supported_tls_modes must equal clusterManaged and external.');
  }

  if (JSON.stringify(topology?.exposure_matrix?.kubernetes?.supported_exposure_kinds ?? []) !== JSON.stringify(['Ingress', 'LoadBalancer'])) {
    violations.push('Deployment topology exposure_matrix.kubernetes.supported_exposure_kinds must equal [Ingress, LoadBalancer].');
  }

  if (JSON.stringify(topology?.exposure_matrix?.openshift?.supported_exposure_kinds ?? []) !== JSON.stringify(['Route'])) {
    violations.push('Deployment topology exposure_matrix.openshift.supported_exposure_kinds must equal [Route].');
  }

  if (topology?.exposure_matrix?.kubernetes?.loadBalancer_tls_mode !== 'external') {
    violations.push('Deployment topology exposure_matrix.kubernetes.loadBalancer_tls_mode must be external.');
  }

  for (const [key, expected] of Object.entries(EXPECTED_UPGRADE_GUARDRAILS)) {
    if (JSON.stringify(topology?.upgrade_guardrails?.[key]) !== JSON.stringify(expected)) {
      violations.push(`Deployment topology upgrade_guardrails.${key} must match the approved upgrade guardrail contract.`);
    }
  }

  for (const key of ['network_policy', 'corporate_proxy', 'internal_certificates', 'file_permissions']) {
    if (!Array.isArray(topology?.operational_constraints?.[key]) || topology.operational_constraints[key].length === 0) {
      violations.push(`Deployment topology operational_constraints.${key} must be a non-empty array.`);
    }
  }

  const bootstrapPolicy = topology?.bootstrap_policy;
  if (!bootstrapPolicy) {
    violations.push('Deployment topology must define bootstrap_policy.');
  } else {
    if (bootstrapPolicy.controller_kind !== 'post_install_upgrade_job') {
      violations.push('Deployment topology bootstrap_policy.controller_kind must be post_install_upgrade_job.');
    }

    if (bootstrapPolicy.lock_resource_kind !== 'ConfigMap') {
      violations.push('Deployment topology bootstrap_policy.lock_resource_kind must be ConfigMap.');
    }

    if (bootstrapPolicy.marker_resource_kind !== 'ConfigMap') {
      violations.push('Deployment topology bootstrap_policy.marker_resource_kind must be ConfigMap.');
    }

    if (JSON.stringify(bootstrapPolicy.supported_secret_strategies ?? []) !== JSON.stringify(REQUIRED_BOOTSTRAP_SECRET_STRATEGIES)) {
      violations.push(
        `Deployment topology bootstrap_policy.supported_secret_strategies must equal ${REQUIRED_BOOTSTRAP_SECRET_STRATEGIES.join(', ')}.`
      );
    }

    if (JSON.stringify(bootstrapPolicy.one_shot_resources ?? []) !== JSON.stringify(REQUIRED_BOOTSTRAP_ONE_SHOT_RESOURCES)) {
      violations.push('Deployment topology bootstrap_policy.one_shot_resources must match the required bootstrap create-only resources.');
    }

    if (JSON.stringify(bootstrapPolicy.reconcile_each_upgrade ?? []) !== JSON.stringify(REQUIRED_BOOTSTRAP_RECONCILE_RESOURCES)) {
      violations.push('Deployment topology bootstrap_policy.reconcile_each_upgrade must match the required bootstrap reconciliation resources.');
    }

    if (!Array.isArray(bootstrapPolicy.restore_behaviour) || bootstrapPolicy.restore_behaviour.length < 3) {
      violations.push('Deployment topology bootstrap_policy.restore_behaviour must document restore and reinstall guardrails.');
    }
  }

  return violations;
}

function collectValuesViolations(topology) {
  const violations = [];

  if (!existsSync(BASE_VALUES_PATH)) {
    violations.push(`Missing base values file ${BASE_VALUES_PATH}.`);
    return violations;
  }

  for (const filePath of [...Object.values(ENVIRONMENT_VALUES), ...Object.values(PLATFORM_VALUES)]) {
    if (!existsSync(filePath)) {
      violations.push(`Missing values overlay ${filePath}.`);
    }
  }

  for (const filePath of [
    'charts/in-falcone/values/customer-reference.yaml',
    'charts/in-falcone/values/airgap.yaml',
    'charts/in-falcone/values/local.example.yaml'
  ]) {
    if (!existsSync(filePath)) {
      violations.push(`Missing deployment values layer ${filePath}.`);
    }
  }

  const baseValues = readValuesFile(BASE_VALUES_PATH);
  if (JSON.stringify(baseValues?.config?.inheritanceOrder ?? []) !== JSON.stringify([...REQUIRED_HELM_VALUE_LAYERS, 'secretRefs'])) {
    violations.push('Base values must keep the documented inheritance order for deployment layers.');
  }

  if (JSON.stringify(Object.keys(baseValues?.deployment?.valuesLayers ?? {})) !== JSON.stringify(REQUIRED_HELM_VALUE_LAYERS)) {
    violations.push('Base values must define the full deployment.valuesLayers map.');
  }

  for (const [layer, expectedPath] of Object.entries({
    common: 'values.yaml',
    environment: 'values/dev.yaml',
    customer: 'values/customer-reference.yaml',
    platform: 'values/platform-kubernetes.yaml',
    airgap: 'values/airgap.yaml',
    localOverride: 'values/local.example.yaml'
  })) {
    if (baseValues?.deployment?.valuesLayers?.[layer] !== expectedPath) {
      violations.push(`Base values layer ${layer} must point to ${expectedPath}.`);
    }
  }

  for (const environmentId of REQUIRED_ENVIRONMENTS) {
    const profile = topology.environment_profiles.find((entry) => entry.id === environmentId);
    if (!profile) continue;

    for (const platformId of REQUIRED_PLATFORMS) {
      const values = resolveValues(environmentId, platformId);
      if (values?.global?.environment !== environmentId) {
        violations.push(`Resolved values for ${environmentId}/${platformId} must set global.environment=${environmentId}.`);
      }

      if (values?.environmentProfile?.id !== environmentId) {
        violations.push(`Resolved values for ${environmentId}/${platformId} must set environmentProfile.id=${environmentId}.`);
      }

      if (values?.platform?.target !== platformId) {
        violations.push(`Resolved values for ${environmentId}/${platformId} must set platform.target=${platformId}.`);
      }

      const expectedExposureKind = topology.platform_matrix[platformId].route_kind;
      if (values?.platform?.network?.exposureKind !== expectedExposureKind) {
        violations.push(
          `Resolved values for ${environmentId}/${platformId} must use exposure kind ${expectedExposureKind}.`
        );
      }

      for (const [key, expected] of Object.entries(REQUIRED_ROUTE_PREFIXES)) {
        const camelKey = key === 'control_plane' ? 'controlPlane' : key;
        if (values?.publicSurface?.routePrefixes?.[camelKey] !== expected) {
          violations.push(`Resolved values for ${environmentId}/${platformId} must keep ${camelKey}=${expected}.`);
        }
      }

      for (const surface of REQUIRED_PUBLIC_SURFACES) {
        const actualHostname = values?.publicSurface?.hostnames?.[surface];
        const expectedHostname = profile.hostnames[surface];
        if (actualHostname !== expectedHostname) {
          violations.push(
            `Resolved values for ${environmentId}/${platformId} hostname ${surface} must align with deployment topology.`
          );
        }
      }

      const expectedWildcard = topology.public_surface.certificate_naming.wildcard_secret_pattern.replace(
        '{environment}',
        environmentId
      );
      if (values?.publicSurface?.certificates?.wildcardSecretName !== expectedWildcard) {
        violations.push(`Resolved values for ${environmentId}/${platformId} must use wildcard secret ${expectedWildcard}.`);
      }

      for (const [secretRefName, secretRef] of Object.entries(values?.config?.secretRefs ?? {})) {
        if (typeof secretRef?.existingSecret !== 'string' || secretRef.existingSecret.length === 0) {
          violations.push(`Secret ref ${secretRefName} in ${environmentId}/${platformId} must use existingSecret.`);
        }
        if ('value' in (secretRef ?? {})) {
          violations.push(`Secret ref ${secretRefName} in ${environmentId}/${platformId} must not inline raw values.`);
        }
      }

      if (values?.config?.secretRefs?.gatewayTls?.existingSecret !== values?.publicSurface?.certificates?.surfaces?.api) {
        violations.push(`Resolved values for ${environmentId}/${platformId} must bind gatewayTls to the API certificate secret.`);
      }

      const bootstrap = values?.bootstrap ?? {};
      if (!bootstrap?.enabled) {
        violations.push(`Resolved values for ${environmentId}/${platformId} must keep bootstrap.enabled=true.`);
      }

      if (bootstrap?.lock?.name === bootstrap?.markers?.name) {
        violations.push(`Resolved values for ${environmentId}/${platformId} must use distinct bootstrap lock and marker names.`);
      }

      if (
        JSON.stringify(bootstrap?.secretResolution?.supportedStrategies ?? []) !==
        JSON.stringify(REQUIRED_BOOTSTRAP_SECRET_STRATEGIES)
      ) {
        violations.push(
          `Resolved values for ${environmentId}/${platformId} must expose bootstrap secret strategies ${REQUIRED_BOOTSTRAP_SECRET_STRATEGIES.join(', ')}.`
        );
      }

      if (!bootstrap?.reconcile?.apisix?.adminService?.enabled) {
        violations.push(`Resolved values for ${environmentId}/${platformId} must expose the APISIX admin service for bootstrap.`);
      }

      const routeNames = new Set((bootstrap?.reconcile?.apisix?.routes ?? []).map((route) => route.name));
      for (const routeName of REQUIRED_BOOTSTRAP_CORE_ROUTES) {
        if (!routeNames.has(routeName)) {
          violations.push(`Resolved values for ${environmentId}/${platformId} must keep APISIX route ${routeName}.`);
        }
      }

      if (values?.gatewayPolicy?.passthrough?.mode !== profile?.operational_profile?.passthrough_mode) {
        violations.push(
          `Resolved values for ${environmentId}/${platformId} must align gatewayPolicy.passthrough.mode with deployment topology passthrough_mode.`
        );
      }
    }
  }

  return violations;
}

function collectOpenApiAlignmentViolations(topology, openapiDocument) {
  const violations = [];
  const servers = openapiDocument?.servers ?? [];
  const firstServer = servers[0];
  const variables = firstServer?.variables ?? {};
  const publicHostVariable = variables.publicHost;
  const compatibilityHeader = topology?.future_topology?.compatibility_contract?.api_version_header;
  const expectedHosts = topology.environment_profiles.map((profile) => profile.hostnames.api);

  if (!firstServer?.url?.includes('{publicHost}')) {
    violations.push('OpenAPI server URL must parameterize the public API hostname.');
  }

  if (!Array.isArray(publicHostVariable?.enum)) {
    violations.push('OpenAPI server must enumerate supported public API hostnames.');
  } else {
    for (const hostname of expectedHosts) {
      if (!publicHostVariable.enum.includes(hostname)) {
        violations.push(`OpenAPI server hostname enum must include ${hostname}.`);
      }
    }
  }

  const getTenantSummary = openapiDocument?.paths?.['/v1/tenants/{tenantId}']?.get;
  const parameters = resolveParameters(openapiDocument, getTenantSummary);
  const versionHeader = parameters.find(
    (parameter) => parameter?.in === 'header' && parameter?.name === 'X-API-Version'
  );

  const expectedPattern = `^${compatibilityHeader?.current_value}$`;
  if (versionHeader?.schema?.pattern !== expectedPattern) {
    violations.push(`OpenAPI X-API-Version header must pin ${compatibilityHeader?.current_value}.`);
  }

  return violations;
}

function collectSmokeMatrixViolations(topology, smokeMatrix) {
  const violations = [];
  const shared = smokeMatrix?.shared_expectations ?? {};
  const scenarios = smokeMatrix?.smoke_scenarios ?? [];

  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    violations.push('Deployment smoke matrix must define smoke_scenarios.');
    return violations;
  }

  const seen = new Set();
  for (const environmentId of REQUIRED_ENVIRONMENTS) {
    for (const platformId of REQUIRED_PLATFORMS) {
      const key = `${environmentId}:${platformId}`;
      seen.add(key);
      if (!scenarios.some((scenario) => scenario.environment === environmentId && scenario.platform === platformId)) {
        violations.push(`Deployment smoke matrix must cover ${environmentId}/${platformId}.`);
      }
    }
  }

  for (const scenario of scenarios) {
    const expectedPlatform = topology.platform_matrix?.[scenario.platform];
    const expectedProfile = topology.environment_profiles?.find((profile) => profile.id === scenario.environment);
    if (!expectedPlatform) {
      violations.push(`Smoke scenario ${String(scenario?.id)} references unknown platform ${String(scenario?.platform)}.`);
      continue;
    }
    if (!expectedProfile) {
      violations.push(`Smoke scenario ${String(scenario?.id)} references unknown environment ${String(scenario?.environment)}.`);
      continue;
    }

    if (scenario.expected_exposure_kind !== expectedPlatform.route_kind) {
      violations.push(`Smoke scenario ${scenario.id} must use exposure kind ${expectedPlatform.route_kind}.`);
    }

    for (const resource of shared.required_resources ?? []) {
      if (!(scenario.required_resources ?? []).includes(resource)) {
        violations.push(`Smoke scenario ${scenario.id} must include required resource ${resource}.`);
      }
    }

    for (const surface of shared.required_host_keys ?? []) {
      if (scenario?.expected_hostnames?.[surface] !== expectedProfile.hostnames[surface]) {
        violations.push(`Smoke scenario ${scenario.id} hostname ${surface} must align with environment profile ${expectedProfile.id}.`);
      }
    }

    const expectedResources = expectedPlatform.base_resources;
    if (JSON.stringify(scenario.required_resources) !== JSON.stringify(expectedResources)) {
      violations.push(`Smoke scenario ${scenario.id} resources must match platform ${scenario.platform} base_resources.`);
    }
  }

  for (const [key, expected] of Object.entries(REQUIRED_ROUTE_PREFIXES)) {
    const camelKey = key === 'control_plane' ? 'controlPlane' : key;
    if (shared?.route_prefixes?.[camelKey] !== expected) {
      violations.push(`Smoke matrix shared route prefix ${camelKey} must equal ${expected}.`);
    }
  }

  return violations;
}

export function collectDeploymentTopologyViolations(
  topology = readDeploymentTopology(),
  smokeMatrix = readDeploymentSmokeMatrix(),
  openapiDocument = readJson(OPENAPI_PATH)
) {
  return [
    ...collectTopologyContractViolations(topology),
    ...collectValuesViolations(topology),
    ...collectOpenApiAlignmentViolations(topology, openapiDocument),
    ...collectSmokeMatrixViolations(topology, smokeMatrix)
  ];
}
