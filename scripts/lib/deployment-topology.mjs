import { existsSync } from 'node:fs';

import { OPENAPI_PATH, readJson, readYaml, resolveParameters } from './quality-gates.mjs';

export const DEPLOYMENT_TOPOLOGY_PATH = 'services/internal-contracts/src/deployment-topology.json';
export const DEPLOYMENT_SMOKE_MATRIX_PATH = 'tests/reference/deployment-smoke-matrix.yaml';
export const BASE_VALUES_PATH = 'charts/in-atelier/values.yaml';
export const ENVIRONMENT_VALUES = {
  dev: 'charts/in-atelier/values/dev.yaml',
  sandbox: 'charts/in-atelier/values/sandbox.yaml',
  staging: 'charts/in-atelier/values/staging.yaml',
  prod: 'charts/in-atelier/values/prod.yaml'
};
export const PLATFORM_VALUES = {
  kubernetes: 'charts/in-atelier/values/platform-kubernetes.yaml',
  openshift: 'charts/in-atelier/values/platform-openshift.yaml'
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

  if (topology?.public_surface?.root_domain !== 'in-atelier.example.com') {
    violations.push('Deployment topology public_surface.root_domain must be in-atelier.example.com.');
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
