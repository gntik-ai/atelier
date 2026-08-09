import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../../apps/web-console/src/', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const canonicalRawCallers = [
  'actions/secretRotationActions.ts',
  'api/configExportApi.ts',
  'api/configPreflightApi.ts',
  'api/configReprovisionApi.ts',
  'api/configSchemaApi.ts',
  'lib/console-openapi-sdk.ts',
  'pages/ConsoleCapabilityCatalogPage.tsx',
  'pages/ConsoleKafkaPage.tsx',
  'services/backupOperationsApi.ts',
  'services/backupStatusApi.ts'
];

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(?:ts|tsx)$/.test(entry) && !/\.(?:test|spec)\./.test(entry)) files.push(path);
  }
  return files;
}

test('C-03 first-party raw public callers use the trace-header transport', () => {
  for (const relativePath of canonicalRawCallers) {
    const source = readFileSync(join(sourceRoot, relativePath), 'utf8');
    assert.match(source, /\bpublicApiFetch\b/, `${relativePath} must use the canonical raw transport`);
    assert.doesNotMatch(source, /\bfetch\s*\(/, `${relativePath} must not bypass the canonical raw transport`);
  }

  const sse = readFileSync(join(sourceRoot, 'lib/sse.ts'), 'utf8');
  assert.match(sse, /publicApiFetch\(url, \{ headers, signal:/, 'shared SSE transport uses publicApiFetch');

  const directPublicFetchFiles = sourceFiles(sourceRoot)
    .filter((path) => {
      const source = readFileSync(path, 'utf8');
      return /\bfetch\s*\(/.test(source) && /\/v1\//.test(source);
    })
    .map((path) => relative(sourceRoot, path))
    .sort();

  assert.deepEqual(directPublicFetchFiles, [
    'services/mongoApi.ts',
    'services/postgresApi.ts',
    'services/privilege-domain-api.ts'
  ], 'new direct /v1 fetch callers must not bypass publicApiFetch');
});

test('C-03 published snippets and the intentional non-public fetch exception remain bounded', () => {
  for (const relativePath of ['services/mongoApi.ts', 'services/postgresApi.ts']) {
    const source = readFileSync(join(sourceRoot, relativePath), 'utf8');
    assert.match(source, /'X-API-Version': '2026-03-26'/, `${relativePath} snippet pins the API version`);
    assert.match(source, /'X-Correlation-Id': crypto\.randomUUID\(\)/, `${relativePath} snippet creates a correlation`);
    assert.match(source, /X-API-Version: 2026-03-26/, `${relativePath} curl pins the API version`);
    assert.match(source, /X-Correlation-Id: corr-client-0001/, `${relativePath} curl supplies a valid correlation`);
  }

  const privilege = readFileSync(join(sourceRoot, 'services/privilege-domain-api.ts'), 'utf8');
  assert.equal((privilege.match(/\bfetch\s*\(/g) ?? []).length, 1, 'only the legacy non-public assignment helper uses fetch');
  assert.match(privilege, /return request\(`\/api\/workspaces\//, 'legacy direct fetch is restricted to the /api facade');
  assert.match(privilege, /requestConsoleSessionJson<DenialsResponse>/, 'its public /v1 caller uses the authenticated canonical transport');
});

test('C-03 non-console first-party public callers send version and correlation metadata', () => {
  const sources = new Map([
    ['OpenAPI SDK capability discovery', 'packages/openapi-sdk-service/src/capability-manifest-client.mjs'],
    ['executor Platform MCP client', 'apps/control-plane-executor/src/runtime/server.mjs'],
    ['hosted MCP runtime client', 'apps/mcp-runtime/server.mjs'],
    ['legacy backup audit console', 'apps/console/src/lib/api/backup-audit.api.ts']
  ]);

  for (const [label, relativePath] of sources) {
    const source = readFileSync(join(repoRoot, relativePath), 'utf8');
    assert.match(source, /["'](?:x-api-version|X-API-Version)["']\s*:/, `${label} sends X-API-Version`);
    assert.match(source, /["'](?:x-correlation-id|X-Correlation-Id)["']\s*:/, `${label} sends X-Correlation-Id`);
    assert.match(source, /2026-03-26|PUBLIC_API_VERSION/, `${label} pins the canonical API version`);
  }

  const mcpDockerfile = readFileSync(join(repoRoot, 'apps/mcp-runtime/Dockerfile'), 'utf8');
  assert.match(
    mcpDockerfile,
    /COPY apps\/shared\/error-envelope\.mjs \/app\/apps\/shared\/error-envelope\.mjs/,
    'the hosted MCP image packages its canonical public-header helper'
  );

  const functionSnippets = readFileSync(join(sourceRoot, 'lib/snippets/snippet-catalog.ts'), 'utf8');
  const functionSection = functionSnippets.split("'serverless-function': [")[1]?.split("'realtime-subscription': [")[0] ?? '';
  assert.match(functionSection, /X-API-Version/);
  assert.match(functionSection, /X-Correlation-Id/);
});
