import { existsSync } from 'node:fs';

import { readDeploymentTopology } from './deployment-topology.mjs';
import { readYaml } from './quality-gates.mjs';

export const ROOT_CHART_PATH = 'charts/in-atelier/Chart.yaml';
export const ROOT_VALUES_PATH = 'charts/in-atelier/values.yaml';
export const ROOT_SCHEMA_PATH = 'charts/in-atelier/values.schema.json';
export const WRAPPER_CHART_PATH = 'charts/in-atelier/charts/component-wrapper/Chart.yaml';
export const WRAPPER_SCHEMA_PATH = 'charts/in-atelier/charts/component-wrapper/values.schema.json';
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

export function readRootChart() {
  return readYaml(ROOT_CHART_PATH);
}

export function readRootValues() {
  return readYaml(ROOT_VALUES_PATH);
}

export function readWrapperChart() {
  return readYaml(WRAPPER_CHART_PATH);
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

export function collectDeploymentChartViolations(
  chart = readRootChart(),
  values = readRootValues(),
  topology = readDeploymentTopology(),
  wrapperChart = readWrapperChart()
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

  if ((topology?.configuration_policy?.helm_value_layers ?? []).join(',') !== REQUIRED_VALUE_LAYERS.join(',')) {
    violations.push('Deployment topology contract must expose the same Helm layer order as the chart.');
  }

  const contractAliases = topology?.packaging_guidance?.component_aliases ?? [];
  if (JSON.stringify(contractAliases) !== JSON.stringify(REQUIRED_COMPONENT_ALIASES)) {
    violations.push('Deployment topology packaging_guidance.component_aliases must align with the chart dependency aliases.');
  }

  for (const [surface, binding] of Object.entries(values?.publicSurface?.bindings ?? {})) {
    const component = values?.[binding.component];
    if (!binding.serviceName && component?.enabled === false) {
      violations.push(`Public surface ${surface} requires an explicit serviceName when ${binding.component} is disabled.`);
    }
  }

  for (const path of [ROOT_SCHEMA_PATH, WRAPPER_SCHEMA_PATH, 'charts/in-atelier/README.md']) {
    if (!existsSync(path)) {
      violations.push(`Required deployment packaging artifact ${path} is missing.`);
    }
  }

  return violations;
}
