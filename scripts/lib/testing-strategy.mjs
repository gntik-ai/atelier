import { OPENAPI_PATH, listOperations, readJson, readYaml, resolveParameters } from './quality-gates.mjs';

export const TESTING_STRATEGY_PATH = 'tests/reference/testing-strategy.yaml';
export const REFERENCE_DATASET_PATH = 'tests/reference/reference-dataset.json';

export const REQUIRED_TEST_LEVELS = ['unit', 'adapter_integration', 'api_contract', 'console_e2e', 'resilience'];
export const REQUIRED_DOMAINS = ['multi_tenant', 'security', 'data', 'events', 'console'];
export const REQUIRED_CONSOLE_STATES = [
  'unauthenticated',
  'platform_admin',
  'tenant_admin',
  'tenant_operator',
  'auditor'
];
export const REQUIRED_TAXONOMY_CATEGORIES = [
  'positive',
  'negative',
  'permission',
  'contract',
  'resilience',
  'recovery'
];

const SCENARIO_ID_PATTERN = /^(UT|AI|AC|CE|RS)-[A-Z]{3}-\d{3}$/;
const DATASET_SECTIONS = [
  'tenants',
  'users',
  'workspaces',
  'adapters',
  'api_versions',
  'events',
  'resilience_cases',
  'console_routes'
];

export function readTestingStrategy() {
  return readYaml(TESTING_STRATEGY_PATH);
}

export function readReferenceDataset() {
  return readJson(REFERENCE_DATASET_PATH);
}

export function buildFixtureIndex(dataset) {
  const fixtureIndex = new Map();

  for (const sectionName of DATASET_SECTIONS) {
    for (const entry of dataset?.[sectionName] ?? []) {
      if (entry?.id) {
        fixtureIndex.set(entry.id, { section: sectionName, value: entry });
      }
    }
  }

  return fixtureIndex;
}

function collectDatasetViolations(dataset) {
  const violations = [];

  for (const sectionName of DATASET_SECTIONS) {
    const section = dataset?.[sectionName];

    if (!Array.isArray(section) || section.length === 0) {
      violations.push(`Reference dataset section ${sectionName} must be a non-empty array.`);
      continue;
    }

    for (const entry of section) {
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || entry.id.length === 0) {
        violations.push(`Reference dataset section ${sectionName} contains an entry without a stable id.`);
      }
    }
  }

  const placements = new Set((dataset?.tenants ?? []).map((tenant) => tenant?.placement));
  if (!placements.has('shared_schema')) {
    violations.push('Reference dataset must include at least one shared_schema tenant fixture.');
  }
  if (!placements.has('dedicated_database')) {
    violations.push('Reference dataset must include at least one dedicated_database tenant fixture.');
  }

  const roles = new Set((dataset?.users ?? []).map((user) => user?.role));
  for (const role of REQUIRED_CONSOLE_STATES.filter((state) => state !== 'unauthenticated')) {
    if (!roles.has(role)) {
      violations.push(`Reference dataset must include a user fixture for role ${role}.`);
    }
  }

  return violations;
}

function extractExactHeaderValue(parameter) {
  const schema = parameter?.schema ?? {};

  if (typeof schema.const === 'string') {
    return schema.const;
  }

  if (Array.isArray(schema.enum) && schema.enum.length === 1 && typeof schema.enum[0] === 'string') {
    return schema.enum[0];
  }

  if (typeof schema.pattern === 'string') {
    const match = schema.pattern.match(/^\^(.+)\$$/);
    if (match) return match[1];
  }

  return null;
}

function collectApiAlignmentViolations(strategy, dataset, openapiDocument) {
  const violations = [];
  const apiContract = strategy?.api_contract ?? {};
  const headerName = apiContract?.version_header?.name;
  const currentValue = apiContract?.version_header?.current_value;
  const uriPrefix = apiContract?.uri_prefix;
  const requireErrorContracts = apiContract?.required_error_contracts === true;

  if (uriPrefix !== '/v1/') {
    violations.push(`Strategy api_contract.uri_prefix must be /v1/; received ${String(uriPrefix)}.`);
  }

  if (headerName !== 'X-API-Version') {
    violations.push(`Strategy api_contract.version_header.name must be X-API-Version; received ${String(headerName)}.`);
  }

  if (typeof currentValue !== 'string' || currentValue.length === 0) {
    violations.push('Strategy api_contract.version_header.current_value must be a non-empty string.');
  }

  const datasetVersion = (dataset?.api_versions ?? []).find((entry) => entry?.id === 'api-version-current');
  if (!datasetVersion) {
    violations.push('Reference dataset must include api-version-current.');
  } else {
    if (datasetVersion.header_name !== headerName) {
      violations.push('Reference dataset api-version-current header_name must align with strategy api_contract.version_header.name.');
    }
    if (datasetVersion.value !== currentValue) {
      violations.push('Reference dataset api-version-current value must align with strategy api_contract.version_header.current_value.');
    }
  }

  let hasAccessCheckPath = false;

  for (const { path, method, operation } of listOperations(openapiDocument).filter(({ path }) => path !== '/health')) {
    const label = `${method.toUpperCase()} ${path}`;

    if (!path.startsWith(uriPrefix ?? '')) {
      violations.push(`${label} in OpenAPI must align with strategy uri prefix ${String(uriPrefix)}.`);
    }

    const parameters = resolveParameters(openapiDocument, operation);

    const versionHeader = parameters.find(
      (parameter) => parameter?.in === 'header' && parameter?.name === headerName && parameter?.required === true
    );

    if (!versionHeader) {
      violations.push(`${label} in OpenAPI must require ${String(headerName)}.`);
      continue;
    }

    const correlationHeader = parameters.find(
      (parameter) => parameter?.in === 'header' && parameter?.name === 'X-Correlation-Id' && parameter?.required === true
    );

    if (!correlationHeader) {
      violations.push(`${label} in OpenAPI must require X-Correlation-Id.`);
    }

    const exactValue = extractExactHeaderValue(versionHeader);
    if (exactValue && exactValue !== currentValue) {
      violations.push(`${label} in OpenAPI requires ${exactValue} but strategy expects ${String(currentValue)}.`);
    }

    if (path.includes('/access-checks')) {
      hasAccessCheckPath = true;
      if (!path.includes('/tenants/{tenantId}/workspaces/{workspaceId}/')) {
        violations.push(`${label} in OpenAPI must remain tenant/workspace-scoped.`);
      }
    }

    if (requireErrorContracts) {
      const responseCodes = Object.keys(operation?.responses ?? {});
      const hasErrorContract = responseCodes.some(
        (status) => status === 'default' || /^4\d\d$/.test(status) || /^5\d\d$/.test(status)
      );

      if (!hasErrorContract) {
        violations.push(`${label} in OpenAPI must declare an error contract to match strategy expectations.`);
      }
    }
  }

  if (!hasAccessCheckPath) {
    violations.push('OpenAPI must include a tenant/workspace-scoped access-check route.');
  }

  return violations;
}

export function collectTestingStrategyViolations(
  strategy,
  dataset,
  openapiDocument = readJson(OPENAPI_PATH)
) {
  const violations = [];

  const pyramid = strategy?.pyramid;
  if (!Array.isArray(pyramid) || pyramid.length === 0) {
    violations.push('Testing strategy pyramid must be a non-empty array.');
  } else {
    const levels = pyramid.map((entry) => entry?.level);

    for (const level of REQUIRED_TEST_LEVELS) {
      if (!levels.includes(level)) {
        violations.push(`Testing strategy pyramid is missing level ${level}.`);
      }
    }

    for (const entry of pyramid) {
      if (!entry?.purpose) {
        violations.push(`Testing strategy level ${String(entry?.level)} must define a purpose.`);
      }
      if (!entry?.why_now) {
        violations.push(`Testing strategy level ${String(entry?.level)} must define why_now.`);
      }
    }
  }

  const domains = strategy?.cross_domain_matrix?.domains;
  const scenarios = strategy?.cross_domain_matrix?.scenarios;
  if (!Array.isArray(domains) || domains.length === 0) {
    violations.push('Testing strategy cross_domain_matrix.domains must be a non-empty array.');
  }
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    violations.push('Testing strategy cross_domain_matrix.scenarios must be a non-empty array.');
  }

  const domainIds = new Set((domains ?? []).map((domain) => domain?.id));
  for (const domain of REQUIRED_DOMAINS) {
    if (!domainIds.has(domain)) {
      violations.push(`Testing strategy is missing required domain ${domain}.`);
    }
  }

  const taxonomyIds = new Set((strategy?.scenario_taxonomy?.categories ?? []).map((category) => category?.id));
  for (const category of REQUIRED_TAXONOMY_CATEGORIES) {
    if (!taxonomyIds.has(category)) {
      violations.push(`Testing strategy taxonomy is missing category ${category}.`);
    }
  }

  const fixtureIndex = buildFixtureIndex(dataset);
  for (const scenario of scenarios ?? []) {
    if (!SCENARIO_ID_PATTERN.test(String(scenario?.id ?? ''))) {
      violations.push(`Scenario id ${String(scenario?.id)} must match ${SCENARIO_ID_PATTERN}.`);
    }

    if (!REQUIRED_TEST_LEVELS.includes(scenario?.level)) {
      violations.push(`Scenario ${String(scenario?.id)} must use a supported level.`);
    }

    if (!REQUIRED_DOMAINS.includes(scenario?.domain)) {
      violations.push(`Scenario ${String(scenario?.id)} must use a supported domain.`);
    }

    if (!taxonomyIds.has(scenario?.taxonomy)) {
      violations.push(`Scenario ${String(scenario?.id)} must reference a known taxonomy category.`);
    }

    if (!Array.isArray(scenario?.fixtures) || scenario.fixtures.length === 0) {
      violations.push(`Scenario ${String(scenario?.id)} must reference at least one fixture.`);
      continue;
    }

    for (const fixtureId of scenario.fixtures) {
      if (!fixtureIndex.has(fixtureId)) {
        violations.push(`Scenario ${String(scenario?.id)} references unknown fixture ${fixtureId}.`);
      }
    }
  }

  for (const level of REQUIRED_TEST_LEVELS) {
    if (!(scenarios ?? []).some((scenario) => scenario?.level === level)) {
      violations.push(`Cross-domain matrix must include at least one scenario for level ${level}.`);
    }
  }

  for (const domain of REQUIRED_DOMAINS) {
    if (!(scenarios ?? []).some((scenario) => scenario?.domain === domain)) {
      violations.push(`Cross-domain matrix must include at least one scenario for domain ${domain}.`);
    }
  }

  const consoleStates = strategy?.console?.states;
  if (!Array.isArray(consoleStates) || consoleStates.length === 0) {
    violations.push('Testing strategy console.states must be a non-empty array.');
  } else {
    const stateIds = new Set(consoleStates.map((state) => state?.id));
    for (const state of REQUIRED_CONSOLE_STATES) {
      if (!stateIds.has(state)) {
        violations.push(`Testing strategy console states are missing ${state}.`);
      }
    }

    for (const state of consoleStates) {
      if (!Array.isArray(state?.visible_sections) || state.visible_sections.length === 0) {
        violations.push(`Console state ${String(state?.id)} must define visible_sections.`);
      }
      if (!Array.isArray(state?.blocked_sections) || state.blocked_sections.length === 0) {
        violations.push(`Console state ${String(state?.id)} must define blocked_sections.`);
      }
      if (!Array.isArray(state?.allowed_actions) || state.allowed_actions.length === 0) {
        violations.push(`Console state ${String(state?.id)} must define allowed_actions.`);
      }
    }
  }

  violations.push(...collectDatasetViolations(dataset));
  violations.push(...collectApiAlignmentViolations(strategy, dataset, openapiDocument));

  return violations;
}
