import { existsSync, readFileSync } from 'node:fs';

import { deepMerge, readDeploymentTopology } from './deployment-topology.mjs';
import { readDomainModel } from './domain-model.mjs';
import { readYaml } from './quality-gates.mjs';

export const ROOT_CHART_PATH = 'charts/in-atelier/Chart.yaml';
export const ROOT_VALUES_PATH = 'charts/in-atelier/values.yaml';
export const ROOT_SCHEMA_PATH = 'charts/in-atelier/values.schema.json';
export const WRAPPER_CHART_PATH = 'charts/in-atelier/charts/component-wrapper/Chart.yaml';
export const WRAPPER_SCHEMA_PATH = 'charts/in-atelier/charts/component-wrapper/values.schema.json';
export const OPTIONAL_LOADBALANCER_VALUES_PATH = 'charts/in-atelier/values/platform-kubernetes-loadbalancer.yaml';
export const REQUIRED_COMPONENT_ALIASES = [
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
export const REQUIRED_VALUE_LAYERS = ['common', 'environment', 'customer', 'platform', 'airgap', 'localOverride'];
export const RECOMMENDED_DEPLOYMENT_PROFILES = ['all-in-one', 'standard', 'ha'];
export const SUPPORTED_TLS_MODES = ['clusterManaged', 'external'];
export const SUPPORTED_LOADBALANCER_PORT_KEYS = ['api', 'console', 'identity', 'realtime'];
export const EXPECTED_SUPPORTED_PREVIOUS_VERSIONS = ['0.2.0'];
export const REQUIRED_BOOTSTRAP_TEMPLATES = [
  'charts/in-atelier/templates/bootstrap-rbac.yaml',
  'charts/in-atelier/templates/bootstrap-payload-configmap.yaml',
  'charts/in-atelier/templates/bootstrap-script-configmap.yaml',
  'charts/in-atelier/templates/bootstrap-job.yaml',
  'charts/in-atelier/templates/bootstrap-apisix-admin-service.yaml'
];
const REQUIRED_BOOTSTRAP_SECRET_STRATEGIES = ['kubernetesSecret', 'env', 'externalRef'];
const REQUIRED_BOOTSTRAP_ONE_SHOT_RESOURCES = ['superadmin', 'platform_realm', 'governance_catalog', 'internal_namespaces'];
const REQUIRED_BOOTSTRAP_RECONCILE_RESOURCES = ['apisix_routes', 'bootstrap_payload_config'];
const REQUIRED_APISIX_ROUTE_PREFIXES = {
  'control-plane': '/control-plane/*',
  identity: '/auth/*',
  realtime: '/realtime/*',
  console: '/*'
};

export function readRootChart() {
  return readYaml(ROOT_CHART_PATH);
}

export function readRootValues() {
  return readYaml(ROOT_VALUES_PATH);
}

export function readWrapperChart() {
  return readYaml(WRAPPER_CHART_PATH);
}

export function readProfileValues(profileId) {
  return readYaml(`charts/in-atelier/values/profiles/${profileId}.yaml`);
}

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function normalizeDependencies(chart) {
  return chart?.dependencies ?? [];
}

function expectedLayerFile(layerName) {
  const mapping = {
    common: 'values.yaml',
    environment: 'values/dev.yaml',
    customer: 'values/customer-reference.yaml',
    platform: 'values/platform-kubernetes.yaml',
    airgap: 'values/airgap.yaml',
    localOverride: 'values/local.example.yaml'
  };

  return mapping[layerName];
}

function profilePath(profileId) {
  return `charts/in-atelier/values/profiles/${profileId}.yaml`;
}

export function resolveImageRepository(repository, globalRegistry = '') {
  const normalizedRegistry = String(globalRegistry ?? '').replace(/\/+$/, '');
  if (!normalizedRegistry) return repository;
  if (repository === normalizedRegistry || repository.startsWith(`${normalizedRegistry}/`)) {
    return repository;
  }

  const segments = String(repository).split('/');
  const first = segments[0] ?? '';
  const hasExplicitRegistry = first.includes('.') || first.includes(':') || first === 'localhost';
  const repositoryPath = hasExplicitRegistry && segments.length > 1 ? segments.slice(1).join('/') : repository;
  return `${normalizedRegistry}/${repositoryPath}`;
}

export function resolveComponentImage(values, alias) {
  const image = values?.[alias]?.image ?? {};
  const repository = resolveImageRepository(image.repository, values?.global?.imageRegistry);
  if (image.digest) {
    return `${repository}@${image.digest}`;
  }
  return `${repository}:${image.tag}`;
}

export function compareVersions(left, right) {
  const toParts = (value) =>
    String(value ?? '')
      .split(/[.-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);

  const leftParts = toParts(left);
  const rightParts = toParts(right);

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }

  return 0;
}

export function collectUpgradeValidationViolations(
  chart = readRootChart(),
  values = readRootValues(),
  { releaseIsUpgrade = false, currentVersion = values?.deployment?.upgrade?.currentVersion } = {}
) {
  const violations = [];
  const upgrade = values?.deployment?.upgrade ?? {};

  if (!releaseIsUpgrade || !upgrade.allowInPlace) {
    return violations;
  }

  if (typeof currentVersion !== 'string' || currentVersion.length === 0) {
    violations.push('deployment.upgrade.currentVersion is required for in-place upgrades.');
    return violations;
  }

  if ((upgrade.supportedPreviousVersions ?? []).length > 0 && !(upgrade.supportedPreviousVersions ?? []).includes(currentVersion)) {
    violations.push(`deployment.upgrade.currentVersion ${currentVersion} is not listed in supportedPreviousVersions.`);
  }

  if (!upgrade.allowDowngrade && compareVersions(currentVersion, chart?.appVersion) > 0) {
    violations.push(`deployment.upgrade.currentVersion ${currentVersion} is newer than target chart appVersion ${chart?.appVersion}.`);
  }

  return violations;
}

function collectBootstrapValueViolations(values, topology, domainModel, violations) {
  const bootstrap = values?.bootstrap;
  if (!bootstrap) {
    violations.push('Root values must define bootstrap.');
    return;
  }

  if (!bootstrap.enabled) {
    violations.push('bootstrap.enabled must remain true for the platform deployment baseline.');
  }

  if (!bootstrap?.job?.image?.repository) {
    violations.push('bootstrap.job.image.repository must be defined.');
  }

  if (!bootstrap?.job?.image?.tag) {
    violations.push('bootstrap.job.image.tag must be defined.');
  }

  if (bootstrap?.lock?.name === bootstrap?.markers?.name) {
    violations.push('bootstrap.lock.name and bootstrap.markers.name must be different resources.');
  }

  const supportedStrategies = bootstrap?.secretResolution?.supportedStrategies ?? [];
  if (JSON.stringify(supportedStrategies) !== JSON.stringify(REQUIRED_BOOTSTRAP_SECRET_STRATEGIES)) {
    violations.push(
      `bootstrap.secretResolution.supportedStrategies must equal ${REQUIRED_BOOTSTRAP_SECRET_STRATEGIES.join(', ')}.`
    );
  }

  if (
    JSON.stringify(topology?.bootstrap_policy?.supported_secret_strategies ?? []) !==
    JSON.stringify(REQUIRED_BOOTSTRAP_SECRET_STRATEGIES)
  ) {
    violations.push('Deployment topology bootstrap_policy.supported_secret_strategies must align with chart bootstrap support.');
  }

  const secretSources = bootstrap?.secretResolution?.sources ?? {};
  if (Object.keys(secretSources).length === 0) {
    violations.push('bootstrap.secretResolution.sources must not be empty.');
  }

  for (const [name, source] of Object.entries(secretSources)) {
    if (!REQUIRED_BOOTSTRAP_SECRET_STRATEGIES.includes(source?.strategy)) {
      violations.push(`bootstrap secret source ${name} must use a supported strategy.`);
    }

    if (typeof source?.envVarName !== 'string' || source.envVarName.length === 0) {
      violations.push(`bootstrap secret source ${name} must define envVarName.`);
    }

    if ('value' in (source ?? {})) {
      violations.push(`bootstrap secret source ${name} must not inline raw values.`);
    }

    if (source?.strategy === 'kubernetesSecret') {
      if (!source?.existingSecret?.name || !source?.existingSecret?.key) {
        violations.push(`bootstrap secret source ${name} must define existingSecret.name and existingSecret.key.`);
      }
    }

    if (source?.strategy === 'externalRef') {
      if (!source?.externalRef?.provider || !source?.externalRef?.reference) {
        violations.push(`bootstrap secret source ${name} must define externalRef.provider and externalRef.reference.`);
      }
    }
  }

  if (!values?.keycloak?.enabled) {
    violations.push('bootstrap baseline requires keycloak.enabled=true.');
  }

  if (!values?.apisix?.enabled) {
    violations.push('bootstrap baseline requires apisix.enabled=true.');
  }

  const governanceCatalog = bootstrap?.oneShot?.governanceCatalog ?? {};
  const domainCatalog = domainModel?.governance_catalogs ?? {};
  if (JSON.stringify(governanceCatalog.plans ?? []) !== JSON.stringify(domainCatalog.plans ?? [])) {
    violations.push('bootstrap.oneShot.governanceCatalog.plans must mirror the canonical domain-model governance catalog.');
  }

  if (JSON.stringify(governanceCatalog.quotaPolicies ?? []) !== JSON.stringify(domainCatalog.quota_policies ?? [])) {
    violations.push(
      'bootstrap.oneShot.governanceCatalog.quotaPolicies must mirror the canonical domain-model quota policy catalog.'
    );
  }

  if (JSON.stringify(governanceCatalog.deploymentProfiles ?? []) !== JSON.stringify(domainCatalog.deployment_profiles ?? [])) {
    violations.push(
      'bootstrap.oneShot.governanceCatalog.deploymentProfiles must mirror the canonical domain-model deployment profile catalog.'
    );
  }

  const internalNamespaces = bootstrap?.oneShot?.internalNamespaces ?? {};
  if (!Array.isArray(internalNamespaces?.openwhisk) || internalNamespaces.openwhisk.length === 0) {
    violations.push('bootstrap.oneShot.internalNamespaces.openwhisk must define at least one namespace.');
  }

  if (!Array.isArray(internalNamespaces?.storage?.buckets) || internalNamespaces.storage.buckets.length === 0) {
    violations.push('bootstrap.oneShot.internalNamespaces.storage.buckets must define at least one bucket prefix set.');
  }

  const routeIds = new Set();
  const routes = bootstrap?.reconcile?.apisix?.routes ?? [];
  if (routes.length !== Object.keys(REQUIRED_APISIX_ROUTE_PREFIXES).length) {
    violations.push('bootstrap.reconcile.apisix.routes must define the four baseline APISIX routes.');
  }

  for (const route of routes) {
    if (routeIds.has(route.routeId)) {
      violations.push(`bootstrap APISIX route ${route.routeId} must be unique.`);
    }
    routeIds.add(route.routeId);

    if (REQUIRED_APISIX_ROUTE_PREFIXES[route.name] !== route.uri) {
      violations.push(`bootstrap APISIX route ${route.name} must use uri ${REQUIRED_APISIX_ROUTE_PREFIXES[route.name]}.`);
    }

    if (!REQUIRED_COMPONENT_ALIASES.includes(route?.upstream?.component)) {
      violations.push(`bootstrap APISIX route ${route.name} references unknown upstream component ${String(route?.upstream?.component)}.`);
    }
  }

  if (!bootstrap?.reconcile?.apisix?.adminService?.enabled) {
    violations.push('bootstrap.reconcile.apisix.adminService.enabled must remain true for bootstrap route reconciliation.');
  }

  if ((topology?.bootstrap_policy?.one_shot_resources ?? []).join(',') !== REQUIRED_BOOTSTRAP_ONE_SHOT_RESOURCES.join(',')) {
    violations.push('Deployment topology bootstrap_policy.one_shot_resources must align with the chart one-shot bootstrap contract.');
  }

  if ((topology?.bootstrap_policy?.reconcile_each_upgrade ?? []).join(',') !== REQUIRED_BOOTSTRAP_RECONCILE_RESOURCES.join(',')) {
    violations.push(
      'Deployment topology bootstrap_policy.reconcile_each_upgrade must align with the chart bootstrap reconciliation contract.'
    );
  }
}

function collectBootstrapTemplateViolations(violations) {
  for (const path of REQUIRED_BOOTSTRAP_TEMPLATES) {
    if (!existsSync(path)) {
      violations.push(`Required bootstrap template ${path} is missing.`);
    }
  }

  if (violations.some((violation) => violation.includes('Required bootstrap template'))) {
    return;
  }

  const jobTemplate = readText('charts/in-atelier/templates/bootstrap-job.yaml');
  const scriptTemplate = readText('charts/in-atelier/templates/bootstrap-script-configmap.yaml');
  const payloadTemplate = readText('charts/in-atelier/templates/bootstrap-payload-configmap.yaml');
  const rbacTemplate = readText('charts/in-atelier/templates/bootstrap-rbac.yaml');
  const adminServiceTemplate = readText('charts/in-atelier/templates/bootstrap-apisix-admin-service.yaml');

  if (!jobTemplate.includes('helm.sh/hook: post-install,post-upgrade')) {
    violations.push('bootstrap job template must run as a post-install/post-upgrade Helm hook.');
  }

  if (!jobTemplate.includes('serviceAccountName: {{ include "in-atelier.bootstrapServiceAccountName" . }}')) {
    violations.push('bootstrap job template must use the dedicated bootstrap service account.');
  }

  if (!jobTemplate.includes('name: tmp') || !jobTemplate.includes('emptyDir: {}')) {
    violations.push('bootstrap job template must mount a writable /tmp volume for read-only root filesystems.');
  }

  for (const marker of ['create-only bootstrap phase', 'upgrade reconciliation phase', 'bootstrap marker already matches']) {
    if (!scriptTemplate.includes(marker)) {
      violations.push(`bootstrap script template must include ${marker}.`);
    }
  }

  for (const marker of ['ensure_keycloak_realm', 'ensure_keycloak_superadmin', 'ensure_apisix_route', 'acquire_lock']) {
    if (!scriptTemplate.includes(marker)) {
      violations.push(`bootstrap script template must implement ${marker}.`);
    }
  }

  for (const marker of ['governance-plans.json', 'governance-quota-policies.json', 'internal-namespaces.json']) {
    if (!payloadTemplate.includes(marker)) {
      violations.push(`bootstrap payload template must include ${marker}.`);
    }
  }

  if (!rbacTemplate.includes('resources:\n      - configmaps')) {
    violations.push('bootstrap RBAC template must grant configmap access for markers and locks.');
  }

  if (!adminServiceTemplate.includes('targetPort: {{ .Values.bootstrap.reconcile.apisix.adminService.targetPort }}')) {
    violations.push('bootstrap APISIX admin service template must expose the configured admin targetPort.');
  }
}

export function collectDeploymentChartViolations(
  chart = readRootChart(),
  values = readRootValues(),
  topology = readDeploymentTopology(),
  wrapperChart = readWrapperChart(),
  domainModel = readDomainModel()
) {
  const violations = [];

  if (chart?.apiVersion !== 'v2') {
    violations.push('Root deployment chart must use apiVersion v2.');
  }

  if (chart?.type !== 'application') {
    violations.push('Root deployment chart must be an application chart.');
  }

  if (wrapperChart?.name !== 'component-wrapper') {
    violations.push('Wrapper chart must be named component-wrapper.');
  }

  if (wrapperChart?.type !== 'application') {
    violations.push('Wrapper chart must be an application chart.');
  }

  const dependencies = normalizeDependencies(chart);
  if (dependencies.length !== REQUIRED_COMPONENT_ALIASES.length) {
    violations.push(`Root chart must declare ${REQUIRED_COMPONENT_ALIASES.length} aliased wrapper dependencies.`);
  }

  for (const alias of REQUIRED_COMPONENT_ALIASES) {
    const dependency = dependencies.find((entry) => entry.alias === alias);
    if (!dependency) {
      violations.push(`Missing wrapper dependency alias ${alias}.`);
      continue;
    }

    if (dependency.name !== 'component-wrapper') {
      violations.push(`Dependency ${alias} must point to the component-wrapper chart.`);
    }

    if (dependency.repository !== 'file://./charts/component-wrapper') {
      violations.push(`Dependency ${alias} must use the local wrapper repository file://./charts/component-wrapper.`);
    }

    if (dependency.condition !== `${alias}.enabled`) {
      violations.push(`Dependency ${alias} must be gated by ${alias}.enabled.`);
    }
  }

  for (const alias of REQUIRED_COMPONENT_ALIASES) {
    const component = values?.[alias];
    if (!component) {
      violations.push(`Root values must define component block ${alias}.`);
      continue;
    }

    if (component?.wrapper?.componentId == null || component.wrapper.componentId.length === 0) {
      violations.push(`Component ${alias} must define wrapper.componentId.`);
    }

    if (component?.enabled && !component?.image?.repository) {
      violations.push(`Component ${alias} must define image.repository when enabled.`);
    }

    if (component?.enabled && !component?.service?.portName) {
      violations.push(`Component ${alias} must define service.portName when enabled.`);
    }

    if (component?.enabled && component?.persistence?.enabled && !component?.persistence?.existingClaim && !component?.persistence?.size) {
      violations.push(`Component ${alias} must define persistence.size when persistence is enabled without existingClaim.`);
    }

    if (component?.serviceAccount?.automountToken !== false) {
      violations.push(`Component ${alias} must disable serviceAccount automountToken by default.`);
    }

    if (component?.securityContext?.runAsNonRoot !== true) {
      violations.push(`Component ${alias} must set securityContext.runAsNonRoot=true.`);
    }
  }

  const layerMap = values?.deployment?.valuesLayers ?? {};
  for (const layer of REQUIRED_VALUE_LAYERS) {
    if (!(layer in layerMap)) {
      violations.push(`deployment.valuesLayers must include ${layer}.`);
      continue;
    }

    const expected = expectedLayerFile(layer);
    if (layerMap[layer] !== expected) {
      violations.push(`deployment.valuesLayers.${layer} must point to ${expected}.`);
    }

    const absolutePath = `charts/in-atelier/${layerMap[layer]}`;
    if (!existsSync(absolutePath)) {
      violations.push(`Referenced values layer file ${absolutePath} does not exist.`);
    }
  }

  const inheritanceOrder = values?.config?.inheritanceOrder ?? [];
  const expectedInheritanceOrder = [...REQUIRED_VALUE_LAYERS, 'secretRefs'];
  if (JSON.stringify(inheritanceOrder) !== JSON.stringify(expectedInheritanceOrder)) {
    violations.push(`config.inheritanceOrder must equal ${expectedInheritanceOrder.join(' -> ')}.`);
  }

  if (values?.global?.airgap?.enabled && !values?.global?.privateRegistry?.registry) {
    violations.push('global.privateRegistry.registry must be set when global.airgap.enabled=true.');
  }

  if (values?.global?.privateRegistry?.enabled && (values?.global?.privateRegistry?.pullSecretNames ?? []).length === 0) {
    violations.push('global.privateRegistry.pullSecretNames must not be empty when the private registry is enabled.');
  }

  if (values?.publicSurface?.tls?.mode && !SUPPORTED_TLS_MODES.includes(values.publicSurface.tls.mode)) {
    violations.push(`publicSurface.tls.mode must be one of ${SUPPORTED_TLS_MODES.join(', ')}.`);
  }

  const loadBalancerPorts = values?.publicSurface?.loadBalancer?.ports ?? {};
  for (const surface of SUPPORTED_LOADBALANCER_PORT_KEYS) {
    if (typeof loadBalancerPorts[surface] !== 'number') {
      violations.push(`publicSurface.loadBalancer.ports.${surface} must be a numeric service port.`);
    }
  }

  const recommendedProfiles = values?.deployment?.recommendedProfiles ?? {};
  if (recommendedProfiles.default !== 'standard') {
    violations.push('deployment.recommendedProfiles.default must be standard.');
  }

  if (recommendedProfiles.pathPattern !== 'values/profiles/{profile}.yaml') {
    violations.push('deployment.recommendedProfiles.pathPattern must be values/profiles/{profile}.yaml.');
  }

  if (JSON.stringify(recommendedProfiles.supported ?? []) !== JSON.stringify(RECOMMENDED_DEPLOYMENT_PROFILES)) {
    violations.push('deployment.recommendedProfiles.supported must list all-in-one, standard, and ha in order.');
  }

  if (values?.deployment?.profile !== recommendedProfiles.default) {
    violations.push('Base values must use the default deployment.profile.');
  }

  for (const profileId of RECOMMENDED_DEPLOYMENT_PROFILES) {
    const absolutePath = profilePath(profileId);
    if (!existsSync(absolutePath)) {
      violations.push(`Recommended deployment profile overlay ${absolutePath} is missing.`);
      continue;
    }

    const profileValues = readProfileValues(profileId);
    if (profileValues?.deployment?.profile !== profileId) {
      violations.push(`Deployment profile overlay ${profileId} must set deployment.profile=${profileId}.`);
    }
  }

  const standardValues = deepMerge(structuredClone(values), readProfileValues('standard'));
  const allInOneValues = deepMerge(structuredClone(values), readProfileValues('all-in-one'));
  const haValues = deepMerge(structuredClone(values), readProfileValues('ha'));

  if (allInOneValues?.controlPlane?.replicas > standardValues?.controlPlane?.replicas) {
    violations.push('all-in-one profile must not scale controlPlane above standard.');
  }

  if (allInOneValues?.webConsole?.replicas > standardValues?.webConsole?.replicas) {
    violations.push('all-in-one profile must not scale webConsole above standard.');
  }

  if (haValues?.apisix?.replicas < standardValues?.apisix?.replicas) {
    violations.push('ha profile must scale apisix to at least the standard profile replica count.');
  }

  if (haValues?.controlPlane?.replicas < standardValues?.controlPlane?.replicas) {
    violations.push('ha profile must scale controlPlane to at least the standard profile replica count.');
  }

  if (haValues?.webConsole?.replicas < standardValues?.webConsole?.replicas) {
    violations.push('ha profile must scale webConsole to at least the standard profile replica count.');
  }

  if (!existsSync(OPTIONAL_LOADBALANCER_VALUES_PATH)) {
    violations.push(`Optional exposure overlay ${OPTIONAL_LOADBALANCER_VALUES_PATH} is missing.`);
  } else {
    const loadBalancerOverlay = readYaml(OPTIONAL_LOADBALANCER_VALUES_PATH);
    if (loadBalancerOverlay?.platform?.network?.exposureKind !== 'LoadBalancer') {
      violations.push('platform-kubernetes-loadbalancer overlay must set platform.network.exposureKind=LoadBalancer.');
    }
    if (loadBalancerOverlay?.publicSurface?.tls?.mode !== 'external') {
      violations.push('platform-kubernetes-loadbalancer overlay must set publicSurface.tls.mode=external.');
    }
  }

  const upgrade = values?.deployment?.upgrade ?? {};
  if (upgrade.allowInPlace !== true) {
    violations.push('deployment.upgrade.allowInPlace must be true.');
  }

  if (JSON.stringify(upgrade.supportedPreviousVersions ?? []) !== JSON.stringify(EXPECTED_SUPPORTED_PREVIOUS_VERSIONS)) {
    violations.push(`deployment.upgrade.supportedPreviousVersions must equal ${EXPECTED_SUPPORTED_PREVIOUS_VERSIONS.join(', ')}.`);
  }

  if (upgrade.allowDowngrade !== false) {
    violations.push('deployment.upgrade.allowDowngrade must be false by default.');
  }

  if (upgrade.strategy !== 'rolling') {
    violations.push('deployment.upgrade.strategy must be rolling.');
  }

  if ((topology?.configuration_policy?.helm_value_layers ?? []).join(',') !== REQUIRED_VALUE_LAYERS.join(',')) {
    violations.push('Deployment topology contract must expose the same Helm layer order as the chart.');
  }

  const contractAliases = topology?.packaging_guidance?.component_aliases ?? [];
  if (JSON.stringify(contractAliases) !== JSON.stringify(REQUIRED_COMPONENT_ALIASES)) {
    violations.push('Deployment topology packaging_guidance.component_aliases must align with the chart dependency aliases.');
  }

  if (JSON.stringify(topology?.packaging_guidance?.deployment_profiles ?? []) !== JSON.stringify(RECOMMENDED_DEPLOYMENT_PROFILES)) {
    violations.push('Deployment topology packaging_guidance.deployment_profiles must align with the chart deployment profiles.');
  }

  if (topology?.packaging_guidance?.profile_values_path !== 'charts/in-atelier/values/profiles/{profile}.yaml') {
    violations.push('Deployment topology packaging_guidance.profile_values_path must point to charts/in-atelier/values/profiles/{profile}.yaml.');
  }

  if (JSON.stringify(topology?.configuration_policy?.optional_helm_value_layers ?? []) !== JSON.stringify(['profile'])) {
    violations.push('Deployment topology configuration_policy.optional_helm_value_layers must equal [profile].');
  }

  for (const [surface, binding] of Object.entries(values?.publicSurface?.bindings ?? {})) {
    const component = values?.[binding.component];
    if (!binding.serviceName && component?.enabled === false) {
      violations.push(`Public surface ${surface} requires an explicit serviceName when ${binding.component} is disabled.`);
    }
  }

  for (const path of [
    ROOT_SCHEMA_PATH,
    WRAPPER_SCHEMA_PATH,
    'charts/in-atelier/README.md',
    'docs/reference/architecture/deployment-topology.md'
  ]) {
    if (!existsSync(path)) {
      violations.push(`Required deployment packaging artifact ${path} is missing.`);
    }
  }

  collectBootstrapValueViolations(values, topology, domainModel, violations);
  collectBootstrapTemplateViolations(violations);

  return violations;
}
