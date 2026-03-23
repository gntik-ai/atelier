import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  listOperations,
  OPENAPI_PATH,
  readJson,
  readYaml,
  resolveParameters
} from './quality-gates.mjs';
import { readAuthorizationModel } from './authorization-model.mjs';
import { readDomainModel } from './domain-model.mjs';

export const PUBLIC_API_TAXONOMY_PATH = 'services/internal-contracts/src/public-api-taxonomy.json';
export const PUBLIC_ROUTE_CATALOG_PATH = 'services/internal-contracts/src/public-route-catalog.json';
export const PUBLIC_API_FAMILY_DIR = 'apps/control-plane/openapi/families';
export const GATEWAY_ROUTING_PATH = 'services/gateway-config/base/public-api-routing.yaml';
export const PUBLIC_API_DOCS_PATH = 'docs/reference/architecture/public-api-surface.md';

export function readPublicApiTaxonomy() {
  return readJson(PUBLIC_API_TAXONOMY_PATH);
}

export function readPublicRouteCatalog() {
  return readJson(PUBLIC_ROUTE_CATALOG_PATH);
}

export function readGatewayRouting() {
  return readYaml(GATEWAY_ROUTING_PATH);
}

export function listFamilyDocumentPaths() {
  try {
    return readdirSync(PUBLIC_API_FAMILY_DIR)
      .filter((entry) => entry.endsWith('.openapi.json'))
      .sort()
      .map((entry) => join(PUBLIC_API_FAMILY_DIR, entry));
  } catch {
    return [];
  }
}

export function readFamilyDocuments() {
  return Object.fromEntries(
    listFamilyDocumentPaths().map((path) => [path, JSON.parse(readFileSync(path, 'utf8'))])
  );
}

function deepClone(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortObjectKeys(value[key])])
  );
}

function collectLocalRefs(value, refs = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectLocalRefs(item, refs);
    }

    return refs;
  }

  if (!value || typeof value !== 'object') {
    return refs;
  }

  if (typeof value.$ref === 'string' && value.$ref.startsWith('#/components/')) {
    refs.add(value.$ref);
  }

  for (const nested of Object.values(value)) {
    collectLocalRefs(nested, refs);
  }

  return refs;
}

function gatherReferencedComponents(document, seeds) {
  const included = {};
  const queue = [...seeds];
  const visited = new Set();

  while (queue.length > 0) {
    const ref = queue.shift();
    if (visited.has(ref)) continue;
    visited.add(ref);

    const [, , section, name] = ref.split('/');
    const source = document.components?.[section]?.[name];
    if (!source) continue;

    included[section] ??= {};
    included[section][name] = deepClone(source);

    for (const nestedRef of collectLocalRefs(source)) {
      if (!visited.has(nestedRef)) {
        queue.push(nestedRef);
      }
    }
  }

  return Object.keys(included).length > 0 ? sortObjectKeys(included) : undefined;
}

function operationFamily(operation) {
  return operation?.['x-family'];
}

function familyTagSet(document, paths) {
  const usedTags = new Set();

  for (const pathItem of Object.values(paths)) {
    for (const operation of Object.values(pathItem)) {
      if (!operation || typeof operation !== 'object') continue;
      for (const tag of operation.tags ?? []) {
        usedTags.add(tag);
      }
    }
  }

  return (document.tags ?? []).filter((tag) => usedTags.has(tag.name));
}

export function buildFamilyDocument(document, taxonomy, familyId) {
  const family = taxonomy.families.find((entry) => entry.id === familyId);
  if (!family) {
    throw new Error(`Unknown API family ${familyId}.`);
  }

  const paths = Object.fromEntries(
    Object.entries(document.paths ?? {}).flatMap(([path, pathItem]) => {
      const selectedOperations = Object.fromEntries(
        Object.entries(pathItem ?? {}).filter(([, operation]) => operationFamily(operation) === familyId)
      );

      return Object.keys(selectedOperations).length > 0 ? [[path, selectedOperations]] : [];
    })
  );

  const refs = collectLocalRefs(paths);
  const components = gatherReferencedComponents(document, refs);

  return {
    openapi: document.openapi,
    jsonSchemaDialect: document.jsonSchemaDialect,
    info: {
      title: `In Atelier ${family.title} API`,
      version: taxonomy.release.openapi_semver,
      summary: family.summary,
      description: `${family.summary} Generated from the unified public API contract for ${taxonomy.release.path_version}.`
    },
    servers: deepClone(document.servers ?? []),
    tags: familyTagSet(document, paths),
    paths,
    components,
    security: deepClone(document.security ?? undefined)
  };
}

function normalizeRequiredHeaders(document, operation) {
  return resolveParameters(document, operation)
    .filter((parameter) => parameter?.in === 'header' && parameter?.required === true)
    .map((parameter) => parameter.name)
    .sort();
}

function normalizeSecurity(operation) {
  return Array.isArray(operation?.security) && operation.security.length > 0;
}

function resolveGatewayProfiles(gatewayRouting, familyId) {
  const routingFamilies = new Map((gatewayRouting?.spec?.families ?? []).map((family) => [family.id, family]));
  const routing = routingFamilies.get(familyId) ?? {};
  const qosProfileName = routing.qosProfile ?? null;
  const requestValidationProfileName = routing.requestValidationProfile ?? null;
  const qosProfile = qosProfileName ? gatewayRouting?.spec?.qosProfiles?.[qosProfileName] ?? {} : {};
  const requestValidationProfile = requestValidationProfileName
    ? gatewayRouting?.spec?.requestValidationProfiles?.[requestValidationProfileName] ?? {}
    : {};

  return {
    routing,
    qosProfileName,
    requestValidationProfileName,
    qosProfile,
    requestValidationProfile
  };
}

export function buildRouteCatalog(
  document = readJson(OPENAPI_PATH),
  taxonomy = readPublicApiTaxonomy(),
  gatewayRouting = readGatewayRouting()
) {
  const allowedHeaders = gatewayRouting?.spec?.allowedRequestHeaders ?? [];

  const routes = listOperations(document)
    .filter(({ path }) => path !== '/health')
    .map(({ path, method, operation }) => {
      const family = taxonomy.families.find((entry) => entry.id === operation['x-family']);
      const { routing, qosProfileName, requestValidationProfileName, qosProfile, requestValidationProfile } =
        resolveGatewayProfiles(gatewayRouting, operation['x-family']);
      const requiredHeaders = normalizeRequiredHeaders(document, operation);
      const supportsIdempotencyKey = requiredHeaders.includes('Idempotency-Key');

      return {
        family: operation['x-family'],
        familyTitle: family?.title ?? null,
        method: method.toUpperCase(),
        path,
        operationId: operation.operationId,
        summary: operation.summary,
        scope: operation['x-scope'] ?? family?.resource_scopes?.[0] ?? null,
        resourceType: operation['x-resource-type'] ?? null,
        visibility: operation['x-visibility'] ?? family?.visibility ?? 'public',
        audiences: operation['x-audiences'] ?? family?.audiences ?? [],
        authRequired: normalizeSecurity(operation),
        requiredHeaders,
        gatewayAllowedHeaders: Array.from(new Set([...requiredHeaders, ...allowedHeaders])).sort(),
        gatewayContextHeaders: routing.propagatedHeaders ?? [],
        gatewayAuthMode: routing.authMode ?? null,
        gatewayRouteClass: routing.routeClass ?? null,
        gatewayQosProfile: qosProfileName,
        gatewayRequestValidationProfile: requestValidationProfileName,
        gatewayTimeoutProfile: qosProfile.timeoutProfile ?? null,
        gatewayRetryProfile: qosProfile.retryProfile ?? null,
        maxRequestBodyBytes: requestValidationProfile.maxBodyBytes ?? null,
        allowedContentTypes: requestValidationProfile.allowedContentTypes ?? [],
        correlationIdRequired: gatewayRouting?.spec?.correlationHeader?.required !== false,
        correlationIdGeneratedWhenMissing: gatewayRouting?.spec?.correlationHeader?.generateWhenMissing === true,
        tenantBinding: routing.tenantBinding ?? null,
        workspaceBinding: routing.workspaceBinding ?? null,
        planCapabilityAnyOf: routing.planCapabilityAnyOf ?? [],
        allowAnonymousOptions: routing.allowAnonymousOptions === true,
        supportsIdempotencyKey,
        idempotencyTtlSeconds: supportsIdempotencyKey ? gatewayRouting?.spec?.idempotencyHeader?.ttlSeconds ?? null : null,
        idempotencyReplayHeader: supportsIdempotencyKey ? gatewayRouting?.spec?.idempotencyHeader?.replayResponseHeader ?? null : null,
        downstreamService: operation['x-owning-service'] ?? family?.owning_service ?? null,
        downstreamAdapters: operation['x-downstream-adapters'] ?? family?.downstream_adapters ?? [],
        rateLimitClass: operation['x-rate-limit-class'] ?? 'default',
        qosBurst: qosProfile.burst ?? 0,
        internalRequestMode: gatewayRouting?.spec?.internalRequestMode?.mode ?? null,
        errorEnvelope: gatewayRouting?.spec?.errorEnvelope?.schema ?? null,
        tags: operation.tags ?? [],
        deprecated: operation.deprecated === true,
        discoveryRoute: taxonomy.versioning.discovery_route
      };
    })
    .sort((left, right) => `${left.family}:${left.path}:${left.method}`.localeCompare(`${right.family}:${right.path}:${right.method}`));

  return {
    version: taxonomy.version,
    release: taxonomy.release,
    generatedFrom: OPENAPI_PATH,
    routes
  };
}

function formatMarkdownTable(rows) {
  return rows.join('\n');
}

export function buildPublicApiDocs(
  document = readJson(OPENAPI_PATH),
  taxonomy = readPublicApiTaxonomy(),
  routeCatalog = buildRouteCatalog(document, taxonomy)
) {
  const gatewayRouting = readGatewayRouting();
  const protectionRows = [
    '| Family | QoS profile | Validation profile | Max body bytes | Timeout profile | Retry profile |',
    '| --- | --- | --- | ---: | --- | --- |',
    ...taxonomy.families.map((family) => {
      const { routing, qosProfileName, requestValidationProfileName, qosProfile, requestValidationProfile } = resolveGatewayProfiles(
        gatewayRouting,
        family.id
      );
      return `| ${family.id} | ${qosProfileName ?? 'n/a'} | ${requestValidationProfileName ?? 'n/a'} | ${requestValidationProfile.maxBodyBytes ?? 'n/a'} | ${qosProfile.timeoutProfile ?? 'n/a'} | ${qosProfile.retryProfile ?? 'n/a'} |`;
    })
  ];
  const familySections = taxonomy.families
    .map((family) => {
      const routes = routeCatalog.routes.filter((route) => route.family === family.id);
      const rows = [
        '| Method | Path | Scope | Resource | Summary |',
        '| --- | --- | --- | --- | --- |',
        ...routes.map(
          (route) =>
            `| ${route.method} | \`${route.path}\` | ${route.scope ?? 'n/a'} | ${route.resourceType ?? 'n/a'} | ${route.summary ?? ''} |`
        )
      ];

      return [`## ${family.title}`, '', family.summary, '', formatMarkdownTable(rows), ''].join('\n');
    })
    .join('\n');

  return [
    '# Public API Surface',
    '',
    `Version: ${taxonomy.release.path_version} (header ${taxonomy.release.header_version}, OpenAPI ${taxonomy.release.openapi_semver})`,
    '',
    '## Product API vs native passthrough',
    '',
    'This document describes the supported product API under `/v1/*`.',
    '',
    'Native operator passthrough routes under `/_native/*` are documented separately in `docs/reference/architecture/gateway-authentication-and-passthrough.md` and are intentionally not part of the normal product surface.',
    '',
    '## Versioning strategy',
    '',
    ...taxonomy.versioning.non_breaking_evolution.map((rule) => `- ${rule}`),
    ...taxonomy.versioning.breaking_change_policy.map((rule) => `- ${rule}`),
    '',
    '## Shared HTTP conventions',
    '',
    `- URI prefix: \`${taxonomy.versioning.uri_prefix}\``,
    `- Discovery route: \`${taxonomy.versioning.discovery_route}\``,
    `- Required headers: ${taxonomy.shared_http.headers.api_version.name}, ${taxonomy.shared_http.headers.correlation_id.name}`,
    `- Gateway correlation continuity: ${taxonomy.shared_http.headers.correlation_id.name} is preserved end-to-end and may be backfilled for downstream continuity when recovery requires it.`,
    `- Idempotency header for mutations: ${taxonomy.shared_http.headers.idempotency_key.name}`,
    `- Idempotency replay header: ${taxonomy.shared_http.errors.replay_header}`,
    `- Pagination: ${taxonomy.shared_http.pagination.cursor_param} + ${taxonomy.shared_http.pagination.limit_param}`,
    `- Filter prefix: \`${taxonomy.shared_http.filtering.filter_prefix}...]\``,
    `- Error schema: \`${taxonomy.shared_http.errors.schema}\` with required fields ${taxonomy.shared_http.errors.required_fields.join(', ')}`,
    `- Retryable gateway statuses: ${(taxonomy.shared_http.errors.retryable_statuses ?? []).join(', ')}`,
    '',
    '## Gateway protection matrix',
    '',
    ...protectionRows,
    '',
    '## Families',
    '',
    familySections
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function writeGeneratedFamilyDocuments(document = readJson(OPENAPI_PATH), taxonomy = readPublicApiTaxonomy()) {
  mkdirSync(PUBLIC_API_FAMILY_DIR, { recursive: true });

  for (const family of taxonomy.families) {
    const familyDocument = sortObjectKeys(buildFamilyDocument(document, taxonomy, family.id));
    writeFileSync(join(PUBLIC_API_FAMILY_DIR, `${family.id}.openapi.json`), `${JSON.stringify(familyDocument, null, 2)}\n`);
  }
}

export function writeGeneratedRouteCatalog(document = readJson(OPENAPI_PATH), taxonomy = readPublicApiTaxonomy()) {
  const routeCatalog = sortObjectKeys(buildRouteCatalog(document, taxonomy));
  writeFileSync(PUBLIC_ROUTE_CATALOG_PATH, `${JSON.stringify(routeCatalog, null, 2)}\n`);

  return routeCatalog;
}

export function writeGeneratedPublicApiDocs(document = readJson(OPENAPI_PATH), taxonomy = readPublicApiTaxonomy()) {
  const routeCatalog = buildRouteCatalog(document, taxonomy);
  mkdirSync(dirname(PUBLIC_API_DOCS_PATH), { recursive: true });
  writeFileSync(PUBLIC_API_DOCS_PATH, `${buildPublicApiDocs(document, taxonomy, routeCatalog)}\n`);
}

function collectOperationViolations(document, taxonomy, violations) {
  const familyIds = new Set(taxonomy.families.map((family) => family.id));
  const familyPrefixes = new Map(taxonomy.families.map((family) => [family.id, family.prefix]));
  const requiredMutationMethods = new Set(taxonomy.shared_http.headers.idempotency_key.required_for_methods);
  const requiredErrorFields = new Set(taxonomy.shared_http.errors.required_fields ?? []);
  const errorSchema = document?.components?.schemas?.[taxonomy.shared_http.errors.schema] ?? {};
  const declaredErrorFields = new Set(errorSchema.required ?? []);

  for (const field of requiredErrorFields) {
    if (!declaredErrorFields.has(field)) {
      violations.push(`OpenAPI error schema ${taxonomy.shared_http.errors.schema} must require field ${field}.`);
    }
  }

  for (const { path, method, operation } of listOperations(document)) {
    if (path === '/health') continue;

    const familyId = operation['x-family'];
    const headers = normalizeRequiredHeaders(document, operation);
    const responseCodes = new Set(Object.keys(operation.responses ?? {}));

    if (!familyIds.has(familyId)) {
      violations.push(`${method.toUpperCase()} ${path} must declare an x-family present in public-api-taxonomy.`);
      continue;
    }

    const prefix = familyPrefixes.get(familyId);
    if (!path.startsWith(prefix)) {
      violations.push(`${method.toUpperCase()} ${path} must use the ${prefix} prefix for family ${familyId}.`);
    }

    if (!headers.includes(taxonomy.shared_http.headers.api_version.name)) {
      violations.push(`${method.toUpperCase()} ${path} must require ${taxonomy.shared_http.headers.api_version.name}.`);
    }

    if (!headers.includes(taxonomy.shared_http.headers.correlation_id.name)) {
      violations.push(`${method.toUpperCase()} ${path} must require ${taxonomy.shared_http.headers.correlation_id.name}.`);
    }

    if (requiredMutationMethods.has(method) && !headers.includes(taxonomy.shared_http.headers.idempotency_key.name)) {
      violations.push(`${method.toUpperCase()} ${path} must require ${taxonomy.shared_http.headers.idempotency_key.name}.`);
    }

    if (!operation['x-scope']) {
      violations.push(`${method.toUpperCase()} ${path} must declare x-scope.`);
    }

    for (const status of ['429', '431', '504']) {
      if (!responseCodes.has(status)) {
        violations.push(`${method.toUpperCase()} ${path} must declare gateway resilience response ${status}.`);
      }
    }

    if ((operation.requestBody || requiredMutationMethods.has(method)) && !responseCodes.has('413')) {
      violations.push(`${method.toUpperCase()} ${path} must declare oversized-body response 413.`);
    }
  }
}

function collectGatewayAlignmentViolations(taxonomy, gatewayRouting, violations) {
  const routingFamilies = gatewayRouting?.spec?.families ?? [];
  const routingById = new Map(routingFamilies.map((family) => [family.id, family]));

  if (gatewayRouting?.spec?.versionHeader?.currentValue !== taxonomy.release.header_version) {
    violations.push(`Gateway routing version header must use ${taxonomy.release.header_version}.`);
  }

  for (const family of taxonomy.families) {
    const routingFamily = routingById.get(family.id);
    if (!routingFamily) {
      violations.push(`Gateway routing must declare family ${family.id}.`);
      continue;
    }

    if (routingFamily.pathPrefix !== family.prefix) {
      violations.push(`Gateway family ${family.id} must use prefix ${family.prefix}.`);
    }

    if (routingFamily.upstreamService !== family.owning_service) {
      violations.push(`Gateway family ${family.id} must target upstream service ${family.owning_service}.`);
    }

    if (!routingFamily.qosProfile || !gatewayRouting?.spec?.qosProfiles?.[routingFamily.qosProfile]) {
      violations.push(`Gateway family ${family.id} must reference a declared qosProfile.`);
    }

    if (!routingFamily.requestValidationProfile || !gatewayRouting?.spec?.requestValidationProfiles?.[routingFamily.requestValidationProfile]) {
      violations.push(`Gateway family ${family.id} must reference a declared requestValidationProfile.`);
    }
  }
}

function collectRouteCatalogViolations(document, taxonomy, routeCatalog, gatewayRouting, violations) {
  const routesByOperation = new Map(routeCatalog.routes.map((route) => [route.operationId, route]));
  const routingById = new Map((gatewayRouting?.spec?.families ?? []).map((family) => [family.id, family]));

  for (const { path, method, operation } of listOperations(document)) {
    if (path === '/health') continue;

    const route = routesByOperation.get(operation.operationId);
    if (!route) {
      violations.push(`Route catalog must contain ${operation.operationId}.`);
      continue;
    }

    if (route.family !== operation['x-family']) {
      violations.push(`Route catalog entry ${operation.operationId} must preserve family ${operation['x-family']}.`);
    }

    if (route.path !== path || route.method !== method.toUpperCase()) {
      violations.push(`Route catalog entry ${operation.operationId} must preserve method/path ${method.toUpperCase()} ${path}.`);
    }

    const routing = routingById.get(route.family);
    if (!routing) continue;

    if (route.gatewayAuthMode !== routing.authMode) {
      violations.push(`Route catalog entry ${operation.operationId} must expose gatewayAuthMode ${routing.authMode}.`);
    }

    if (route.gatewayRouteClass !== routing.routeClass) {
      violations.push(`Route catalog entry ${operation.operationId} must expose gatewayRouteClass ${routing.routeClass}.`);
    }

    if (JSON.stringify(route.gatewayContextHeaders ?? []) !== JSON.stringify(routing.propagatedHeaders ?? [])) {
      violations.push(`Route catalog entry ${operation.operationId} must expose gatewayContextHeaders from routing policy.`);
    }

    if (route.gatewayQosProfile !== routing.qosProfile) {
      violations.push(`Route catalog entry ${operation.operationId} must expose gatewayQosProfile ${routing.qosProfile}.`);
    }

    if (route.gatewayRequestValidationProfile !== routing.requestValidationProfile) {
      violations.push(
        `Route catalog entry ${operation.operationId} must expose gatewayRequestValidationProfile ${routing.requestValidationProfile}.`
      );
    }

    if (route.internalRequestMode !== gatewayRouting?.spec?.internalRequestMode?.mode) {
      violations.push(`Route catalog entry ${operation.operationId} must expose internalRequestMode from gateway routing.`);
    }

    if (route.errorEnvelope !== gatewayRouting?.spec?.errorEnvelope?.schema) {
      violations.push(`Route catalog entry ${operation.operationId} must expose errorEnvelope ${gatewayRouting?.spec?.errorEnvelope?.schema}.`);
    }
  }

  const catalogOperation = document.paths?.[taxonomy.versioning.discovery_route]?.get;
  if (!catalogOperation) {
    violations.push(`Unified OpenAPI must expose discovery route ${taxonomy.versioning.discovery_route}.`);
  }
}

function collectDomainAndAuthorizationAlignmentViolations(document, taxonomy, violations) {
  const domainModel = readDomainModel();
  const authorizationModel = readAuthorizationModel();
  const authorizationResourceTypes = new Set((authorizationModel.resource_semantics ?? []).map((entry) => entry.resource_type));
  const taxonomyResources = taxonomy.resource_taxonomy ?? [];

  for (const entity of domainModel.entities ?? []) {
    if (!document.paths?.[entity.openapi?.read_path]) {
      violations.push(`Domain entity ${entity.id} must preserve read path ${entity.openapi?.read_path}.`);
    }

    if (!document.paths?.[entity.openapi?.write_path]) {
      violations.push(`Domain entity ${entity.id} must preserve write path ${entity.openapi?.write_path}.`);
    }
  }

  for (const resource of taxonomyResources) {
    if (resource.authorization_resource && !authorizationResourceTypes.has(resource.authorization_resource)) {
      violations.push(
        `Public API taxonomy resource ${resource.resource_type} must map to known authorization resource ${resource.authorization_resource}.`
      );
    }
  }
}

export function collectPublicApiViolations({
  document = readJson(OPENAPI_PATH),
  taxonomy = readPublicApiTaxonomy(),
  gatewayRouting = readGatewayRouting(),
  routeCatalog = buildRouteCatalog(document, taxonomy, gatewayRouting)
} = {}) {
  const violations = [];

  if (document?.info?.version !== taxonomy.release.openapi_semver) {
    violations.push(`Unified OpenAPI info.version must equal ${taxonomy.release.openapi_semver}.`);
  }

  collectOperationViolations(document, taxonomy, violations);
  collectGatewayAlignmentViolations(taxonomy, gatewayRouting, violations);
  collectRouteCatalogViolations(document, taxonomy, routeCatalog, gatewayRouting, violations);
  collectDomainAndAuthorizationAlignmentViolations(document, taxonomy, violations);

  return violations;
}
