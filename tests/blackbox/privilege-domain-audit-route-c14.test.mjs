/**
 * C-14 black-box/source-contract regression.
 *
 * This suite intentionally stays on public and shipped source boundaries: route
 * maps, generated contracts, the console client, edge configuration, the
 * exported governance migration inventory, and the existing action export. It
 * uses no external network, database, or cluster dependency.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GOVERNANCE_MIGRATIONS } from '../../apps/control-plane/governance-schema.mjs';
import { main as queryPrivilegeDomainAudit } from '../../packages/provisioning-orchestrator/src/actions/privilege-domain-audit-query.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CANONICAL_PATH = '/v1/workspaces/{workspaceId}/privilege-domains/audit';
const OPERATION_ID = 'queryPrivilegeDomainAudit';
const ACTION_MODULE = 'packages/provisioning-orchestrator/src/actions/privilege-domain-audit-query.mjs';
const LEGACY_AUDIT_PATHS = [
  '/api/workspaces/{workspaceId}/privilege-domains/audit',
  '/api/security/privilege-domains/denials'
];

const TENANT_A = 'tenant-c14-a';
const TENANT_B = 'tenant-c14-b';
const UNKNOWN_WORKSPACE = 'workspace-c14-unknown';

async function source(relativePath) {
  return readFile(resolve(REPO_ROOT, relativePath), 'utf8');
}

async function json(relativePath) {
  return JSON.parse(await source(relativePath));
}

function sorted(values) {
  return [...values].sort();
}

function resolveLocalRef(spec, value) {
  if (!value?.$ref) return value;
  assert.match(value.$ref, /^#\//, `expected a local OpenAPI reference, received ${value.$ref}`);
  return value.$ref
    .slice(2)
    .split('/')
    .reduce((cursor, segment) => cursor?.[segment.replaceAll('~1', '/').replaceAll('~0', '~')], spec);
}

function parametersByLocation(spec, operation, location) {
  return operation.parameters
    .map((parameter) => resolveLocalRef(spec, parameter))
    .filter((parameter) => parameter.in === location);
}

function acceptsNull(schema) {
  if (!schema) return false;
  if (schema.nullable === true) return true;
  if (Array.isArray(schema.type) && schema.type.includes('null')) return true;
  if (Array.isArray(schema.enum) && schema.enum.includes(null)) return true;
  return [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])].some((branch) => acceptsNull(branch));
}

function extractExportedFunction(fileSource, exportName) {
  const marker = `export async function ${exportName}`;
  const start = fileSource.indexOf(marker);
  assert.notEqual(start, -1, `missing exported ${exportName} client function`);
  const tail = fileSource.slice(start);
  const nextExport = tail.slice(marker.length).search(/\nexport\s/);
  return nextExport === -1 ? tail : tail.slice(0, marker.length + nextExport);
}

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n\r]*/g, ' ');
}

function apisixRouteBlock(yaml, uri) {
  const routeBlocks = yaml.split(/(?=^  - id:)/m);
  const block = routeBlocks.find((candidate) => {
    const declaredUri = candidate.match(/^\s+uri:\s*["']([^"']+)["']\s*$/m)?.[1];
    return declaredUri === uri;
  });
  assert.ok(block, `missing shipped APISIX route ${uri}`);
  return block;
}

function apisixPriority(block) {
  const priority = Number(block.match(/^\s+priority:\s*(\d+)\s*$/m)?.[1]);
  assert.ok(Number.isFinite(priority), 'APISIX route must declare a numeric priority');
  return priority;
}

class RecordingReadDatabase {
  calls = [];

  async query(statement, values = []) {
    const sql = String(statement);
    this.calls.push({ sql, values: [...values] });
    assert.match(sql, /^\s*SELECT\b/i, 'the audit GET may only issue read queries');
    if (/SELECT\s+COUNT\(\*\)::int\s+AS\s+total/i.test(sql)) {
      return { rows: [{ total: 0 }] };
    }
    return { rows: [] };
  }
}

async function assertRejectedBeforeRepository(params, expectedStatus, expectedBody) {
  const db = new RecordingReadDatabase();
  const response = await queryPrivilegeDomainAudit(params, { db });
  assert.equal(response.statusCode, expectedStatus);
  assert.deepEqual(response.body, expectedBody);
  assert.equal(db.calls.length, 0, 'authorization/validation rejection must precede the repository');
}

/**
 * bbx-c14-01
 * Canonical public route-map identity and preserved runtime dispatch contract.
 */
test('bbx-c14-01 | both control-plane maps expose only the canonical authenticated audit GET', async () => {
  const [discoveryMap, runtimeMap] = await Promise.all([
    json('apps/control-plane/route-map.json'),
    json('apps/control-plane/route-map.runtime.json')
  ]);

  const discoveryEntries = discoveryMap.filter(
    (entry) => entry.operationId === OPERATION_ID || String(entry.module).endsWith(ACTION_MODULE)
  );
  const runtimeEntries = runtimeMap.filter((entry) => String(entry.module).endsWith(ACTION_MODULE));
  assert.equal(discoveryEntries.length, 1, 'discovery map must contain exactly one audit action entry');
  assert.equal(runtimeEntries.length, 1, 'runtime map must contain exactly one audit action entry');

  const discovery = discoveryEntries[0];
  assert.deepEqual(
    {
      operationId: discovery.operationId,
      method: discovery.method,
      path: discovery.path,
      family: discovery.family,
      module: discovery.module,
      export: discovery.export,
      invoke: discovery.invoke,
      deps: discovery.deps,
      auth: discovery.auth
    },
    {
      operationId: OPERATION_ID,
      method: 'GET',
      path: CANONICAL_PATH,
      family: 'workspaces',
      module: ACTION_MODULE,
      export: 'main',
      invoke: 'params-auth-overrides',
      deps: ['pg'],
      auth: 'tenant/workspace scope'
    }
  );

  const runtime = runtimeEntries[0];
  assert.deepEqual(
    {
      method: runtime.method,
      path: runtime.path,
      module: runtime.module,
      export: runtime.export,
      invoke: runtime.invoke,
      deps: runtime.deps,
      auth: runtime.auth,
      mergeQueryIntoParams: runtime.mergeQueryIntoParams
    },
    {
      method: 'GET',
      path: CANONICAL_PATH,
      module: `/repo/${ACTION_MODULE}`,
      export: 'main',
      invoke: 'params-auth-overrides',
      deps: ['db'],
      auth: 'authenticated',
      mergeQueryIntoParams: true
    }
  );

  for (const legacyPath of LEGACY_AUDIT_PATHS) {
    assert.equal(
      [...discoveryMap, ...runtimeMap].some((entry) => entry.path === legacyPath),
      false,
      `C-14 must not retain the audit alias ${legacyPath}`
    );
  }
});

/**
 * bbx-c14-02
 * Unified/generated OpenAPI, generated route catalog, and generated reference parity.
 */
test('bbx-c14-02 | generated public contracts publish queryPrivilegeDomainAudit with the exact success shape and no 404', async () => {
  const [unified, workspaces, catalog, docs] = await Promise.all([
    json('apps/control-plane-executor/openapi/control-plane.openapi.json'),
    json('apps/control-plane-executor/openapi/families/workspaces.openapi.json'),
    json('packages/internal-contracts/src/public-route-catalog.json'),
    source('docs/reference/architecture/public-api-surface.md')
  ]);

  const unifiedOperation = unified.paths?.[CANONICAL_PATH]?.get;
  const generatedOperation = workspaces.paths?.[CANONICAL_PATH]?.get;
  assert.ok(unifiedOperation, `unified OpenAPI is missing GET ${CANONICAL_PATH}`);
  assert.ok(generatedOperation, `generated workspaces family is missing GET ${CANONICAL_PATH}`);
  assert.equal(unifiedOperation.operationId, OPERATION_ID);
  assert.deepEqual(generatedOperation, unifiedOperation, 'generated operation must equal its unified source');
  assert.equal(unifiedOperation['x-family'], 'workspaces');
  assert.equal(unifiedOperation['x-scope'], 'workspace');
  assert.deepEqual(unifiedOperation.security, [{ bearerAuth: [] }]);

  const pathParameters = parametersByLocation(unified, unifiedOperation, 'path');
  assert.deepEqual(pathParameters.map(({ name }) => name), ['workspaceId']);
  assert.equal(pathParameters[0].required, true);

  const headerParameters = parametersByLocation(unified, unifiedOperation, 'header');
  assert.deepEqual(sorted(headerParameters.map(({ name }) => name)), ['X-API-Version', 'X-Correlation-Id']);
  assert.ok(headerParameters.every(({ required }) => required === true), 'both public headers must be required');

  const queryParameters = parametersByLocation(unified, unifiedOperation, 'query');
  assert.deepEqual(
    sorted(queryParameters.map(({ name }) => name)),
    ['actorId', 'from', 'limit', 'offset', 'requiredDomain', 'tenantId', 'to']
  );
  assert.ok(
    queryParameters.every(({ required }) => required !== true),
    'tenantId is conditional by role and no audit query filter is unconditionally required'
  );

  assert.equal('404' in unifiedOperation.responses, false, 'historical absence must not be documented as 404');
  const success = resolveLocalRef(
    unified,
    unifiedOperation.responses?.['200']?.content?.['application/json']?.schema
  );
  assert.equal(success?.type, 'object');
  assert.equal(success.additionalProperties, false);
  assert.deepEqual(sorted(success.required ?? []), ['denials', 'limit', 'offset', 'total']);
  assert.equal(success.properties?.denials?.type, 'array');
  for (const property of ['total', 'limit', 'offset']) {
    assert.equal(success.properties?.[property]?.type, 'integer', `${property} must be an integer`);
  }

  const denial = resolveLocalRef(unified, success.properties.denials.items);
  const denialFields = [
    'actorId',
    'actorType',
    'correlationId',
    'credentialDomain',
    'deniedAt',
    'httpMethod',
    'id',
    'requestPath',
    'requiredDomain',
    'sourceIp',
    'tenantId',
    'workspaceId'
  ];
  assert.equal(denial?.type, 'object');
  assert.equal(denial.additionalProperties, false);
  assert.deepEqual(sorted(Object.keys(denial.properties ?? {})), denialFields);
  assert.deepEqual(sorted(denial.required ?? []), denialFields);
  for (const nullableField of ['workspaceId', 'credentialDomain', 'sourceIp']) {
    assert.equal(acceptsNull(denial.properties[nullableField]), true, `${nullableField} must accept null`);
  }

  const catalogEntries = catalog.routes.filter((route) => route.operationId === OPERATION_ID);
  assert.equal(catalogEntries.length, 1, 'generated public catalog must contain one operation entry');
  assert.equal(catalogEntries[0].method, 'GET');
  assert.equal(catalogEntries[0].path, CANONICAL_PATH);
  assert.equal(catalogEntries[0].family, 'workspaces');
  assert.equal(catalogEntries[0].scope, 'workspace');
  assert.equal(catalogEntries[0].authRequired, true);
  assert.deepEqual(sorted(catalogEntries[0].requiredHeaders), ['X-API-Version', 'X-Correlation-Id']);
  assert.ok(
    docs.includes(`| GET | \`${CANONICAL_PATH}\` | workspace |`),
    'generated public API reference must contain the canonical workspace operation row'
  );

  const checkedPublicArtifacts = [
    JSON.stringify(unified.paths),
    JSON.stringify(workspaces.paths),
    JSON.stringify(catalog.routes),
    docs
  ];
  for (const legacyPath of LEGACY_AUDIT_PATHS) {
    assert.ok(
      checkedPublicArtifacts.every((artifact) => !artifact.includes(legacyPath)),
      `public/generated artifacts must not publish ${legacyPath}`
    );
  }
});

/**
 * bbx-c14-03
 * Console audit transport is authenticated, workspace-canonical, and alias-free.
 */
test('bbx-c14-03 | only the audit client uses the console session helper and an encoded canonical workspace path', async () => {
  const clientSource = await source('apps/web-console/src/services/privilege-domain-api.ts');
  const auditFunction = extractExportedFunction(clientSource, 'queryPrivilegeDomainDenials');

  assert.match(
    clientSource,
    /import\s*\{[^}]*\brequestConsoleSessionJson\b[^}]*\}\s*from\s*['"]@\/lib\/console-session['"]/,
    'audit transport must import the authenticated console-session helper'
  );
  assert.match(auditFunction, /\brequestConsoleSessionJson\s*</);
  assert.doesNotMatch(auditFunction, /\bfetch\s*\(/, 'the audit function must not use bare fetch');
  assert.doesNotMatch(auditFunction, /\breturn\s+request\s*\(/, 'the audit function must not use the legacy request wrapper');
  assert.doesNotMatch(auditFunction, /workspaceId\s*\?\s*:/, 'workspace path scope must be a required separate argument');
  assert.doesNotMatch(
    auditFunction,
    /\b(?:search|params)\.(?:set|append)\s*\(\s*['"]workspaceId['"]/,
    'workspaceId must not be serialized as a replaceable query parameter'
  );

  const canonicalTemplate = auditFunction.match(
    /\/v1\/workspaces\/\$\{([^}]+)\}\/privilege-domains\/audit/
  );
  assert.ok(canonicalTemplate, 'audit function must construct the canonical workspace URL');
  const pathExpression = canonicalTemplate[1].trim();
  if (!/encodeURIComponent\s*\(/.test(pathExpression)) {
    const encodedAssignment = new RegExp(
      `\\b(?:const|let)\\s+${pathExpression.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*encodeURIComponent\\s*\\(`
    );
    assert.match(auditFunction, encodedAssignment, 'workspace path segment must come from encodeURIComponent');
  }
  assert.match(auditFunction, /\btenantId\b/, 'the active tenant scope must remain in the audit query');

  assert.doesNotMatch(clientSource, /\/api\/security\/privilege-domains\/denials/);
  assert.doesNotMatch(
    clientSource,
    /\/api\/workspaces\/(?:\$\{[^}]+\}|\{workspaceId\})\/privilege-domains\/audit/
  );
});

/**
 * bbx-c14-04
 * Shipped same-origin and APISIX precedence, inspected without contacting either service.
 */
test('bbx-c14-04 | shipped static edge and APISIX route workspace /v1 to control-plane before SPA', async () => {
  const [staticServer, dockerfile, apisix] = await Promise.all([
    source('apps/web-console/static-server.mjs'),
    source('apps/web-console/Dockerfile'),
    source('deploy/kind/apisix/apisix.yaml')
  ]);

  assert.match(dockerfile, /COPY\s+apps\/web-console\/static-server\.mjs\s+\.\/static-server\.mjs/);
  assert.match(dockerfile, /CMD\s+\[\s*["']node["']\s*,\s*["']static-server\.mjs["']\s*\]/);

  const apiGuard = /if\s*\(\s*req\.url\s*===\s*['"]\/v1['"][\s\S]*?startsWith\(\s*['"]\/v1\/['"]\s*\)\s*\)/.exec(staticServer);
  assert.ok(apiGuard, 'release static server must classify exact /v1 and /v1/* as API traffic');
  const proxyPosition = staticServer.indexOf('http.request', apiGuard.index);
  const spaFallbackPosition = staticServer.indexOf("join(ROOT, 'index.html')", apiGuard.index);
  assert.ok(proxyPosition > apiGuard.index, '/v1 classification must enter the gateway proxy');
  assert.ok(spaFallbackPosition > proxyPosition, '/v1 gateway proxy must precede the SPA index fallback');
  assert.match(staticServer.slice(apiGuard.index, spaFallbackPosition), /GATEWAY_UPSTREAM|GW_HOST/);

  const workspaceRoute = apisixRouteBlock(apisix, '/v1/workspaces/*');
  const v1FallbackRoute = apisixRouteBlock(apisix, '/v1/*');
  const spaRoute = apisixRouteBlock(apisix, '/*');
  for (const route of [workspaceRoute, v1FallbackRoute]) {
    assert.match(route, /falcone-control-plane[^\n]*:8080/, 'workspace API route must target control-plane');
    assert.ok(
      apisixPriority(route) > apisixPriority(spaRoute),
      'workspace API route must outrank the web-console SPA catch-all'
    );
  }
  assert.match(spaRoute, /falcone-web-console[^\n]*:3000/);
  assert.match(workspaceRoute, /methods:\s*\[[^\]]*"GET"[^\]]*\]/);
});

/**
 * bbx-c14-05
 * Governance bootstrap is a dedicated, denial-only, data-preserving migration.
 */
test('bbx-c14-05 | governance registers one non-094 migration containing only the denial table and its three indexes', async () => {
  assert.ok(
    GOVERNANCE_MIGRATIONS.every((migration) => !/^094(?:-|_)/.test(basename(migration))),
    'the broad 094 migration must remain outside governance bootstrap'
  );

  const registeredSql = await Promise.all(
    GOVERNANCE_MIGRATIONS.map(async (migration) => ({ migration, sql: await source(migration) }))
  );
  const denialMigrations = registeredSql.filter(({ sql }) =>
    /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?privilege_domain_denials\b/i.test(
      stripSqlComments(sql)
    )
  );
  assert.equal(denialMigrations.length, 1, 'exactly one registered migration must bootstrap denial history');

  const { migration, sql: rawSql } = denialMigrations[0];
  assert.doesNotMatch(basename(migration), /^094(?:-|_)/, 'denial bootstrap must be dedicated and non-094');
  const sql = stripSqlComments(rawSql);

  const createdTables = [...sql.matchAll(
    /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:[a-z_][\w$]*\.)?[a-z_][\w$]*)/gi
  )].map((match) => match[1].split('.').at(-1));
  assert.deepEqual(createdTables, ['privilege_domain_denials']);

  const createdIndexes = [...sql.matchAll(
    /\bCREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][\w$]*)\s+ON\s+(?:public\.)?([a-z_][\w$]*)/gi
  )].map((match) => ({ name: match[1], table: match[2] }));
  assert.equal(createdIndexes.length, 3, 'denial bootstrap must create exactly three direct indexes');
  assert.ok(createdIndexes.every(({ table }) => table === 'privilege_domain_denials'));
  assert.deepEqual(
    sorted(createdIndexes.map(({ name }) => name)),
    ['idx_pdd_required_domain', 'idx_pdd_tenant_denied_at', 'idx_pdd_workspace_denied_at']
  );
  assert.match(sql, /idx_pdd_tenant_denied_at[\s\S]*?\(\s*tenant_id\s*,\s*denied_at\s+DESC\s*\)/i);
  assert.match(
    sql,
    /idx_pdd_workspace_denied_at[\s\S]*?\(\s*workspace_id\s*,\s*denied_at\s+DESC\s*\)[\s\S]*?WHERE\s+workspace_id\s+IS\s+NOT\s+NULL/i
  );
  assert.match(sql, /idx_pdd_required_domain[\s\S]*?\(\s*required_domain\s*,\s*denied_at\s+DESC\s*\)/i);

  assert.match(sql, /\bid\s+UUID\s+PRIMARY\s+KEY\s+DEFAULT\s+gen_random_uuid\s*\(\s*\)/i);
  assert.match(sql, /\btenant_id\s+UUID\s+NOT\s+NULL/i);
  assert.match(sql, /\bworkspace_id\s+UUID\b(?!\s+NOT\s+NULL)/i);
  assert.match(sql, /\bcorrelation_id\s+TEXT\s+NOT\s+NULL[\s\S]*?UNIQUE\s*\(\s*correlation_id\s*\)/i);
  assert.match(sql, /\bdenied_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+now\s*\(\s*\)/i);

  assert.doesNotMatch(
    sql,
    /\b(?:privilege_domain_assignments|privilege_domain_assignment_history|workspace_structural_admin_count|api_keys|endpoint_scope_requirements)\b/i,
    'dedicated migration must not contain broad 094 objects'
  );
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i, 'bootstrap must not mutate data');
  assert.doesNotMatch(sql, /\b(?:ALTER|CREATE\s+(?:OR\s+REPLACE\s+)?VIEW)\b/i);
});

/**
 * bbx-c14-06
 * Direct action behavior is frozen: exact roles, pre-query rejection, and empty history 200.
 */
test('bbx-c14-06 | existing action preserves exact role gates and unknown-workspace empty 200 semantics', async () => {
  const platformDb = new RecordingReadDatabase();
  const platformResponse = await queryPrivilegeDomainAudit(
    {
      tenantId: TENANT_A,
      workspaceId: UNKNOWN_WORKSPACE,
      requiredDomain: 'data_access',
      actorId: 'actor-c14',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-05T00:00:00.000Z',
      limit: 999,
      offset: 7,
      auth: { roles: ['platform_admin'] }
    },
    { db: platformDb }
  );
  assert.deepEqual(platformResponse, {
    statusCode: 200,
    body: { denials: [], total: 0, limit: 200, offset: 7 }
  });
  assert.equal(platformDb.calls.length, 2, 'authorized unknown history performs count and list reads');
  assert.match(platformDb.calls[0].sql, /\btenant_id\s*=\s*\$1\b/i);
  assert.match(platformDb.calls[0].sql, /\bworkspace_id\s*=\s*\$2\b/i);
  assert.match(platformDb.calls[1].sql, /ORDER\s+BY\s+denied_at\s+DESC/i);
  assert.deepEqual(platformDb.calls[0].values, [
    TENANT_A,
    UNKNOWN_WORKSPACE,
    'data_access',
    'actor-c14',
    '2026-08-01T00:00:00.000Z',
    '2026-08-05T00:00:00.000Z'
  ]);
  assert.deepEqual(platformDb.calls[1].values, [
    TENANT_A,
    UNKNOWN_WORKSPACE,
    'data_access',
    'actor-c14',
    '2026-08-01T00:00:00.000Z',
    '2026-08-05T00:00:00.000Z',
    200,
    7
  ]);

  const ownerDb = new RecordingReadDatabase();
  const ownerResponse = await queryPrivilegeDomainAudit(
    {
      workspaceId: UNKNOWN_WORKSPACE,
      auth: { roles: ['tenant_owner'], tenantId: TENANT_A }
    },
    { db: ownerDb }
  );
  assert.deepEqual(ownerResponse, {
    statusCode: 200,
    body: { denials: [], total: 0, limit: 50, offset: 0 }
  });
  assert.equal(ownerDb.calls.length, 2);
  assert.deepEqual(ownerDb.calls[0].values, [TENANT_A, UNKNOWN_WORKSPACE]);

  await assertRejectedBeforeRepository(
    { workspaceId: UNKNOWN_WORKSPACE, auth: { roles: ['platform_admin'] } },
    400,
    { error: 'VALIDATION_ERROR', message: 'tenantId is required for platform_admin queries' }
  );
  await assertRejectedBeforeRepository(
    { auth: { roles: ['platform_admin', 'tenant_owner'], tenantId: TENANT_A } },
    400,
    { error: 'VALIDATION_ERROR', message: 'tenantId is required for platform_admin queries' }
  );
  await assertRejectedBeforeRepository(
    {
      tenantId: TENANT_B,
      workspaceId: UNKNOWN_WORKSPACE,
      auth: { roles: ['tenant_owner'], tenantId: TENANT_A }
    },
    403,
    { error: 'FORBIDDEN', message: 'tenant mismatch' }
  );
  await assertRejectedBeforeRepository(
    { workspaceId: UNKNOWN_WORKSPACE, auth: { roles: ['tenant_owner'] } },
    403,
    { error: 'FORBIDDEN', message: 'tenant mismatch' }
  );

  for (const role of [
    'superadmin',
    'platform_auditor',
    'tenant_admin',
    'workspace_owner',
    'workspace_admin',
    'workspace_auditor'
  ]) {
    await assertRejectedBeforeRepository(
      { tenantId: TENANT_A, workspaceId: UNKNOWN_WORKSPACE, auth: { roles: [role], tenantId: TENANT_A } },
      403,
      { error: 'FORBIDDEN', message: 'insufficient privileges' }
    );
  }
});
