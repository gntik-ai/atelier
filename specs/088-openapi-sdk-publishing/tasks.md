<!-- markdownlint-disable MD022 MD031 MD040 -->
# Tasks: OpenAPI Publishing & SDK Generation

**Branch**: `088-openapi-sdk-publishing` | **Date**: 2026-03-30  
**Task ID**: US-DX-02-T04 | **Epic**: EP-17 | **Story**: US-DX-02  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

---

## File Path Map

All paths relative to `/root/projects/falcone/`.

### New files to create

| Alias | Absolute Path |
|-------|--------------|
| `MIGRATION_VERSIONS` | `services/openapi-sdk-service/migrations/088-workspace-openapi-versions.sql` |
| `MIGRATION_PACKAGES` | `services/openapi-sdk-service/migrations/088-workspace-sdk-packages.sql` |
| `PKG_JSON` | `services/openapi-sdk-service/package.json` |
| `CONFIG` | `services/openapi-sdk-service/src/config.mjs` |
| `SPEC_ASSEMBLER` | `services/openapi-sdk-service/src/spec-assembler.mjs` |
| `SPEC_VERSION_REPO` | `services/openapi-sdk-service/src/spec-version-repo.mjs` |
| `SDK_PACKAGE_REPO` | `services/openapi-sdk-service/src/sdk-package-repo.mjs` |
| `SDK_BUILDER` | `services/openapi-sdk-service/src/sdk-builder.mjs` |
| `SDK_STORAGE` | `services/openapi-sdk-service/src/sdk-storage.mjs` |
| `SPEC_CACHE` | `services/openapi-sdk-service/src/spec-cache.mjs` |
| `SPEC_AUDIT` | `services/openapi-sdk-service/src/spec-audit.mjs` |
| `CAPABILITY_CLIENT` | `services/openapi-sdk-service/src/capability-manifest-client.mjs` |
| `ACTION_SERVE` | `services/openapi-sdk-service/actions/openapi-spec-serve.mjs` |
| `ACTION_REGEN` | `services/openapi-sdk-service/actions/openapi-spec-regenerate.mjs` |
| `ACTION_SDK_GEN` | `services/openapi-sdk-service/actions/sdk-generate.mjs` |
| `BASE_TEMPLATE` | `services/openapi-sdk-service/src/capability-modules/base-template.openapi.json` |
| `CAP_AUTH` | `services/openapi-sdk-service/src/capability-modules/auth.paths.json` |
| `CAP_STORAGE` | `services/openapi-sdk-service/src/capability-modules/storage.paths.json` |
| `CAP_FUNCTIONS` | `services/openapi-sdk-service/src/capability-modules/functions.paths.json` |
| `CAP_REALTIME` | `services/openapi-sdk-service/src/capability-modules/realtime.paths.json` |
| `CAP_MONGODB` | `services/openapi-sdk-service/src/capability-modules/mongodb.paths.json` |
| `CAP_POSTGRESQL` | `services/openapi-sdk-service/src/capability-modules/postgresql.paths.json` |
| `CAP_EVENTS` | `services/openapi-sdk-service/src/capability-modules/events.paths.json` |
| `TEST_ASSEMBLER` | `services/openapi-sdk-service/tests/spec-assembler.test.mjs` |
| `TEST_VERSION_REPO` | `services/openapi-sdk-service/tests/spec-version-repo.test.mjs` |
| `TEST_SDK_BUILDER` | `services/openapi-sdk-service/tests/sdk-builder.test.mjs` |
| `TEST_SDK_STORAGE` | `services/openapi-sdk-service/tests/sdk-storage.test.mjs` |
| `TEST_SPEC_CACHE` | `services/openapi-sdk-service/tests/spec-cache.test.mjs` |
| `TEST_ACTION_SERVE` | `services/openapi-sdk-service/tests/openapi-spec-serve.action.test.mjs` |
| `ROUTE_FRAGMENT` | `services/gateway-config/openapi-fragments/workspace-openapi-sdk.openapi.json` |
| `CONTRACT_WOV` | `services/internal-contracts/src/workspace-openapi-version.json` |
| `CONTRACT_SDK_PKG` | `services/internal-contracts/src/sdk-package.json` |
| `CONTRACT_SPEC_UPDATED` | `services/internal-contracts/src/openapi-spec-updated-event.json` |
| `CONTRACT_SDK_COMPLETED` | `services/internal-contracts/src/sdk-generation-completed-event.json` |
| `PAGE_API_REF` | `apps/web-console/src/pages/ConsoleApiReferencePage.tsx` |
| `PAGE_API_REF_TEST` | `apps/web-console/src/pages/ConsoleApiReferencePage.test.tsx` |
| `COMP_VIEWER` | `apps/web-console/src/components/console/OpenApiViewer.tsx` |
| `COMP_VIEWER_TEST` | `apps/web-console/src/components/console/OpenApiViewer.test.tsx` |
| `COMP_SDK_PANEL` | `apps/web-console/src/components/console/SdkDownloadPanel.tsx` |
| `COMP_SDK_PANEL_TEST` | `apps/web-console/src/components/console/SdkDownloadPanel.test.tsx` |
| `COMP_SPEC_DL_BTN` | `apps/web-console/src/components/console/SpecDownloadButton.tsx` |
| `LIB_OPENAPI_SDK` | `apps/web-console/src/lib/console-openapi-sdk.ts` |
| `DATA_MODEL_DOC` | `specs/088-openapi-sdk-publishing/data-model.md` |
| `CONTRACT_SPEC_RESPONSE` | `specs/088-openapi-sdk-publishing/contracts/openapi-spec-response.json` |
| `CONTRACT_SDK_STATUS_RESPONSE` | `specs/088-openapi-sdk-publishing/contracts/sdk-package-status-response.json` |
| `CONTRACT_SPEC_UPDATED_EVENT` | `specs/088-openapi-sdk-publishing/contracts/openapi-spec-updated-event.json` |
| `CONTRACT_SDK_COMPLETED_EVENT` | `specs/088-openapi-sdk-publishing/contracts/sdk-generation-completed-event.json` |
| `CONTRACT_WOV_ENTITY` | `specs/088-openapi-sdk-publishing/contracts/workspace-openapi-version.json` |
| `CONTRACT_SDK_PKG_ENTITY` | `specs/088-openapi-sdk-publishing/contracts/sdk-package.json` |

### Files to modify (existing)

| Alias | Absolute Path | Change |
|-------|--------------|--------|
| `PNPM_WS` | `pnpm-workspace.yaml` | Add `services/openapi-sdk-service` to workspace packages |
| `INTERNAL_CONTRACTS_INDEX` | `services/internal-contracts/src/index.mjs` | Export new contract schemas |

---

## Phase 0 — Scaffolding & Research

### T0-01 · Create service package skeleton
**File**: `PKG_JSON`  
**What**: ESM `package.json` for `services/openapi-sdk-service`. Type `"module"`, scripts `test`, `lint`. Dependencies: `pg`, `kafkajs`, `js-yaml`. DevDependencies: `@stoplight/spectral-core`, `@stoplight/spectral-rulesets`, `@openapitools/openapi-generator-cli`.

```json
{
  "name": "@falcone/openapi-sdk-service",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test tests/**/*.test.mjs",
    "lint:openapi": "spectral lint --ruleset .spectral.yaml"
  },
  "dependencies": {
    "kafkajs": "*",
    "js-yaml": "^4.1.0",
    "pg": "*"
  },
  "devDependencies": {
    "@openapitools/openapi-generator-cli": "^2.13.4",
    "@stoplight/spectral-core": "^1.18.3",
    "@stoplight/spectral-rulesets": "^1.19.0"
  }
}
```

**Acceptance**: `pnpm install` at repo root picks up the new workspace package without error.

---

### T0-02 · Register workspace package in pnpm-workspace.yaml
**File**: `PNPM_WS`  
**What**: Append `- 'services/openapi-sdk-service'` to the `packages` list (or confirm glob already covers it via `services/*`).  
**Acceptance**: `pnpm ls -r | grep openapi-sdk-service` shows the package.

---

### T0-03 · Write environment configuration module
**File**: `CONFIG`  
**What**: Export a frozen config object reading from `process.env`. All required env vars validated at import time; throws if missing in production mode.

```js
// services/openapi-sdk-service/src/config.mjs
export const config = Object.freeze({
  pgConnectionString:   process.env.DATABASE_URL,
  kafkaBrokers:         (process.env.KAFKA_BROKERS || '').split(',').filter(Boolean),
  kafkaClientId:        process.env.KAFKA_CLIENT_ID || 'openapi-sdk-service',
  s3Endpoint:           process.env.S3_ENDPOINT,
  s3Bucket:             process.env.S3_SDK_BUCKET || 'workspace-sdks',
  s3AccessKey:          process.env.S3_ACCESS_KEY,
  s3SecretKey:          process.env.S3_SECRET_KEY,
  s3PresignedUrlTtlSeconds: Number(process.env.S3_PRESIGNED_URL_TTL_SECONDS || 86400),
  effectiveCapabilitiesBaseUrl: process.env.EFFECTIVE_CAPABILITIES_BASE_URL,
  specRateLimitPerMinute: Number(process.env.SPEC_RATE_LIMIT_PER_MINUTE || 60),
  sdkSdkRetentionDays: Number(process.env.SDK_RETENTION_DAYS || 90),
  nodeEnv: process.env.NODE_ENV || 'development',
});
```

**Acceptance**: Module imports cleanly; unit test verifies throwing when `DATABASE_URL` missing in prod mode.

---

## Phase 1 — Database Migrations

### T1-01 · DDL: workspace_openapi_versions table
**File**: `MIGRATION_VERSIONS`  
**What**: Create the `workspace_openapi_versions` table exactly as specified in the data model section of plan.md. Include all indexes and the deferred unique constraint.

```sql
-- 088-workspace-openapi-versions.sql
CREATE TABLE IF NOT EXISTS workspace_openapi_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  workspace_id    UUID NOT NULL,
  spec_version    VARCHAR(64) NOT NULL,
  content_hash    VARCHAR(72) NOT NULL,
  format_json     TEXT NOT NULL,
  format_yaml     TEXT NOT NULL,
  capability_tags TEXT[] NOT NULL,
  is_current      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_workspace_current
    UNIQUE (workspace_id, is_current)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_wov_workspace_current
  ON workspace_openapi_versions (workspace_id, is_current)
  WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_wov_tenant
  ON workspace_openapi_versions (tenant_id);
```

**Acceptance**: Migration runs idempotently (`IF NOT EXISTS`). `\d workspace_openapi_versions` shows all columns and indexes.

---

### T1-02 · DDL: workspace_sdk_packages table
**File**: `MIGRATION_PACKAGES`  
**What**: Create the `workspace_sdk_packages` table. Include status check constraint.

```sql
-- 088-workspace-sdk-packages.sql
CREATE TABLE IF NOT EXISTS workspace_sdk_packages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  workspace_id    UUID NOT NULL,
  language        VARCHAR(32) NOT NULL,
  spec_version    VARCHAR(64) NOT NULL,
  status          VARCHAR(16) NOT NULL
                    CHECK (status IN ('pending','building','ready','failed','stale')),
  download_url    TEXT,
  url_expires_at  TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_sdk_lang_version
    UNIQUE (workspace_id, language, spec_version)
);

CREATE INDEX IF NOT EXISTS idx_wsp_workspace_lang
  ON workspace_sdk_packages (workspace_id, language, status);
```

**Acceptance**: Migration runs cleanly. Check constraint rejects unknown status values.

---

## Phase 2 — Core Backend Modules

### T2-01 · Implement spec-version-repo.mjs
**File**: `SPEC_VERSION_REPO`  
**What**: PostgreSQL repository for `workspace_openapi_versions`. All DB I/O via `pg` Pool.

Exports:
- `getCurrentSpec(pool, workspaceId)` → `{ id, specVersion, contentHash, formatJson, formatYaml, capabilityTags, createdAt } | null`
- `insertNewSpec(pool, { tenantId, workspaceId, specVersion, contentHash, formatJson, formatYaml, capabilityTags })` → `{ id }` — wraps the flip of `is_current` in a deferred transaction:
  1. `BEGIN`
  2. `UPDATE workspace_openapi_versions SET is_current = FALSE WHERE workspace_id = $1 AND is_current = TRUE`
  3. `INSERT INTO workspace_openapi_versions (...) VALUES (...)` with `is_current = TRUE`
  4. `COMMIT`
- `getSpecHistory(pool, workspaceId, limit)` → array of version rows ordered by `created_at DESC`

**Acceptance**: Unit test (`TEST_VERSION_REPO`) verifies insert + flip of current flag, concurrent inserts serialized correctly, and `getCurrentSpec` returns null for unknown workspace.

---

### T2-02 · Implement sdk-package-repo.mjs
**File**: `SDK_PACKAGE_REPO`  
**What**: PostgreSQL repository for `workspace_sdk_packages`.

Exports:
- `upsertSdkPackage(pool, { tenantId, workspaceId, language, specVersion })` → `{ id, status }` — inserts with `status = 'pending'` if no row exists for (workspace, language, specVersion); returns existing row otherwise (idempotent)
- `updateSdkPackageStatus(pool, id, { status, downloadUrl, urlExpiresAt, errorMessage })` → void
- `getSdkPackage(pool, workspaceId, language)` → latest package row for workspace+language (any status)
- `markStaleSdkPackages(pool, workspaceId, currentSpecVersion)` → marks all `ready` packages for this workspace with a different specVersion as `stale`

**Acceptance**: Unit test verifies upsert idempotency (second upsert returns same id), stale marking, and status update.

---

### T2-03 · Implement capability-manifest-client.mjs
**File**: `CAPABILITY_CLIENT`  
**What**: HTTP adapter that calls `GET {EFFECTIVE_CAPABILITIES_BASE_URL}/v1/workspaces/{workspaceId}/effective-capabilities` with a service-to-service token (forwarded from action context headers). Returns the set of enabled capability tag strings.

```js
export async function fetchEnabledCapabilities(workspaceId, authToken) {
  const url = `${config.effectiveCapabilitiesBaseUrl}/v1/workspaces/${workspaceId}/effective-capabilities`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${authToken}` } });
  if (!res.ok) throw new Error(`capabilities fetch failed: ${res.status}`);
  const body = await res.json();
  // body.capabilities is string[] e.g. ["storage","authentication","functions"]
  return new Set(body.capabilities ?? []);
}
```

**Acceptance**: Unit test with a mocked `fetch` verifies capability set returned correctly; throws on non-2xx.

---

### T2-04 · Implement spec-cache.mjs
**File**: `SPEC_CACHE`  
**What**: Pure utility functions for ETag handling (no external I/O).

Exports:
- `computeContentHash(jsonString)` → `"sha256:{hex}"` using Node built-in `crypto.createHash('sha256')`
- `etagFromHash(contentHash)` → `"\"sha256:{hex}\""` (quoted per HTTP spec)
- `isEtagMatch(requestIfNoneMatch, contentHash)` → boolean

**Acceptance**: Unit test (`TEST_SPEC_CACHE`) verifies hash stability, quoted format, and match/no-match cases.

---

### T2-05 · Implement spec-audit.mjs
**File**: `SPEC_AUDIT`  
**What**: Thin Kafka producer wrapper. Emits audit events for spec access and version changes.

Exports:
- `emitSpecAccessed(kafka, { workspaceId, tenantId, specVersion, requesterId, format })` → publishes to `console.openapi.spec.accessed`
- `emitSpecUpdated(kafka, { workspaceId, tenantId, specVersion, previousSpecVersion, contentHash, capabilityTags, changeType })` → publishes to `console.openapi.spec.updated`
- `emitSdkDownloadAccessed(kafka, { workspaceId, tenantId, language, specVersion, requesterId })` → publishes to `console.sdk.download.accessed`
- `emitSdkGenerationCompleted(kafka, { workspaceId, tenantId, language, specVersion, status, errorMessage })` → publishes to `console.sdk.generation.completed`

All events include `timestamp: new Date().toISOString()` and `eventType` field.  
Kafka topics used:
- `console.openapi.spec.accessed` (7d retention)
- `console.openapi.spec.updated` (30d retention)
- `console.sdk.download.accessed` (7d retention)
- `console.sdk.generation.completed` (7d retention)

**Acceptance**: Unit test mocks a kafka object and verifies correct topic + payload shape for each emit function.

---

## Phase 3 — Capability Module Fragments & Spec Assembler

### T3-01 · Create base OpenAPI template
**File**: `BASE_TEMPLATE`  
**What**: `base-template.openapi.json` — The scaffold every assembled spec starts from. Contains:
- `openapi: "3.1.0"`
- `info`: `{ title: "Falcone Workspace API", version: "__VERSION__", description: "..." }`
- `servers`: `[{ url: "__BASE_URL__", description: "Workspace API" }]`
- `components.securitySchemes`: `BearerAuth` (HTTP Bearer JWT) + `ApiKeyAuth` (header `X-Api-Key`)
- `security`: `[{ BearerAuth: [] }, { ApiKeyAuth: [] }]`
- `components.schemas`: common error schemas — `ErrorResponse { code, message, requestId }`, `PaginationMeta`
- `paths`: `{}` (empty — filled by assembler)
- `tags`: `[]` (filled by assembler)

**Acceptance**: Valid JSON; `JSON.parse(readFileSync(BASE_TEMPLATE))` succeeds; spectral oas lint passes on the base template alone.

---

### T3-02 · Create capability path modules (auth, storage, functions)
**Files**: `CAP_AUTH`, `CAP_STORAGE`, `CAP_FUNCTIONS`  
**What**: Three JSON files, each a self-contained OpenAPI fragment with:
- `tag`: `{ name: "authentication" | "storage" | "functions", description: "..." }`
- `paths`: representative endpoint stubs (2-3 paths each) with operations, parameters, `$ref`-free inline schemas (assembler inlines all refs)
- `components.schemas`: schemas used by those paths

Example shape for `auth.paths.json`:
```json
{
  "tag": { "name": "authentication", "description": "Workspace authentication operations" },
  "paths": {
    "/auth/tokens": {
      "post": {
        "operationId": "createToken",
        "tags": ["authentication"],
        "summary": "Issue a workspace API token",
        "requestBody": { ... },
        "responses": { "201": { ... }, "400": { ... }, "401": { ... } }
      }
    },
    "/auth/tokens/{tokenId}": {
      "delete": { "operationId": "revokeToken", ... }
    }
  },
  "components": { "schemas": { "TokenRequest": {...}, "TokenResponse": {...} } }
}
```

**Acceptance**: Each fragment is valid JSON. spec-assembler.test verifies paths from enabled fragments appear in assembled doc; paths from disabled fragments are absent.

---

### T3-03 · Create capability path modules (realtime, mongodb, postgresql, events)
**Files**: `CAP_REALTIME`, `CAP_MONGODB`, `CAP_POSTGRESQL`, `CAP_EVENTS`  
**What**: Same structure as T3-02 for the remaining four capability tags.

- `realtime`: `/channels/**` paths
- `mongodb`: `/mongo/**` paths  
- `postgresql`: `/pg/**` paths
- `events`: `/events/**` paths

**Acceptance**: Same as T3-02. All four fragments are valid JSON with representative paths.

---

### T3-04 · Implement spec-assembler.mjs
**File**: `SPEC_ASSEMBLER`  
**What**: Core assembly logic. No I/O — pure function over JSON data + capability set.

```js
// services/openapi-sdk-service/src/spec-assembler.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CAPABILITY_MODULES = {
  authentication: 'capability-modules/auth.paths.json',
  storage:        'capability-modules/storage.paths.json',
  functions:      'capability-modules/functions.paths.json',
  realtime:       'capability-modules/realtime.paths.json',
  mongodb:        'capability-modules/mongodb.paths.json',
  postgresql:     'capability-modules/postgresql.paths.json',
  events:         'capability-modules/events.paths.json',
};

/**
 * @param {Object} opts
 * @param {Set<string>} opts.enabledCapabilities - e.g. new Set(['storage','authentication'])
 * @param {string} opts.workspaceBaseUrl - e.g. "https://api.tenant.falcone.dev/workspace/abc"
 * @param {string} opts.previousSpecVersion - semver string of current published spec, or "0.0.0"
 * @param {string[]} opts.previousCapabilityTags - tags from previous spec version
 * @returns {{ formatJson: string, formatYaml: string, contentHash: string, specVersion: string, capabilityTags: string[] }}
 */
export function assembleSpec({ enabledCapabilities, workspaceBaseUrl, previousSpecVersion, previousCapabilityTags }) { ... }

/**
 * Compute next semver given previous version and capability change delta.
 * MAJOR if capabilities removed, MINOR if added, PATCH if same set.
 */
export function computeNextVersion(previousVersion, previousTags, newTags) { ... }
```

Implementation details:
1. Load `base-template.openapi.json` (cached after first load)
2. Deep-clone the base template
3. For each capability in `CAPABILITY_MODULES`, if the capability is in `enabledCapabilities`:
   - Load the module JSON (cached)
   - Merge `module.paths` into `spec.paths`
   - Merge `module.components.schemas` into `spec.components.schemas`
   - Push `module.tag` to `spec.tags`
4. Set `spec.servers[0].url = workspaceBaseUrl`
5. Compute `capabilityTags = [...enabledCapabilities].sort()`
6. Compute `specVersion = computeNextVersion(previousSpecVersion, previousCapabilityTags, capabilityTags)`
7. Set `spec.info.version = specVersion`
8. Serialize to JSON (`formatJson = JSON.stringify(spec, null, 2)`)
9. Serialize to YAML (`formatYaml = yaml.dump(spec)`)
10. Compute `contentHash = "sha256:" + createHash('sha256').update(formatJson).digest('hex')`

**Acceptance**: `TEST_ASSEMBLER` verifies:
- Enabled capability paths present in output
- Disabled capability paths absent from output
- `info.version` set to expected semver
- `servers[0].url` equals provided base URL
- Output passes spectral oas lint programmatically
- Empty capability set produces valid spec with no paths

---

### T3-05 · Write spec-assembler unit tests
**File**: `TEST_ASSEMBLER`  
**What**: `node:test` test suite covering:

1. `assembleSpec` with `{ storage, authentication }` — storage + auth paths present, realtime/mongodb paths absent
2. `assembleSpec` with empty set — valid spec, `paths` is empty object or `{}`
3. `computeNextVersion` — adding a capability returns MINOR bump; removing returns MAJOR bump; same set returns PATCH bump (description-only)
4. `contentHash` format is `"sha256:{64 hex chars}"`
5. Spectral lint of assembled spec for storage+auth combination — zero errors (uses `@stoplight/spectral-core` programmatically)

**Acceptance**: `pnpm --filter @falcone/openapi-sdk-service test` passes all 5 test cases.

---

## Phase 4 — OpenWhisk Actions

### T4-01 · Implement openapi-spec-serve.mjs action
**File**: `ACTION_SERVE`  
**What**: OpenWhisk action handling `GET /v1/workspaces/{workspaceId}/openapi`. Reads from `workspace_openapi_versions`.

```js
// services/openapi-sdk-service/actions/openapi-spec-serve.mjs
import pg from 'pg';
import { Kafka } from 'kafkajs';
import { config } from '../src/config.mjs';
import { getCurrentSpec } from '../src/spec-version-repo.mjs';
import { etagFromHash, isEtagMatch } from '../src/spec-cache.mjs';
import { emitSpecAccessed } from '../src/spec-audit.mjs';

export async function main(params) { ... }
```

Logic:
1. Extract `workspaceId` from `params.__ow_path` (e.g. `/v1/workspaces/{id}/openapi`)
2. Extract `tenantId` + `requesterId` from `params.__ow_headers['x-auth-workspace-id']` / `x-auth-user-id`
3. Verify `tenantId` matches workspace's tenant (cross-tenant guard) → 403 if mismatch
4. Check rate limit (simple in-memory per-workspace counter or delegate to APISIX header)
5. Determine format from `params.__ow_query.format` or `Accept` header — default `json`
6. Load `getCurrentSpec(pool, workspaceId)` — 404 if null
7. Check `If-None-Match` header against `etagFromHash(spec.contentHash)` → 304 if match
8. Emit `emitSpecAccessed` (fire-and-forget, don't await in hot path)
9. Return 200 with spec content, ETag, `X-Spec-Version`, `Cache-Control` headers
10. Set `Content-Type: application/json` or `application/x-yaml`

Return format follows OpenWhisk HTTP action conventions:
```js
return {
  statusCode: 200,
  headers: { 'Content-Type': 'application/json', ETag: etag, 'X-Spec-Version': spec.specVersion, 'Cache-Control': 'max-age=60, must-revalidate' },
  body: spec.formatJson
};
```

**Acceptance**: `TEST_ACTION_SERVE` verifies all HTTP response codes: 200 JSON, 200 YAML, 304 on matching ETag, 401 missing auth, 403 cross-tenant, 404 no spec, 429 rate limit.

---

### T4-02 · Implement openapi-spec-regenerate.mjs action
**File**: `ACTION_REGEN`  
**What**: OpenWhisk action triggered by Kafka topic `console.workspace.capability.changed`. Assembles and stores a new spec version.

```js
export async function main(params) {
  // params.workspaceId, params.tenantId, params.authToken (service token)
  const enabledCapabilities = await fetchEnabledCapabilities(params.workspaceId, params.authToken);
  const current = await getCurrentSpec(pool, params.workspaceId);
  const previousVersion = current?.specVersion ?? '0.0.0';
  const previousTags = current?.capabilityTags ?? [];

  const assembled = assembleSpec({
    enabledCapabilities,
    workspaceBaseUrl: params.workspaceBaseUrl,
    previousSpecVersion: previousVersion,
    previousCapabilityTags: previousTags
  });

  // Idempotency guard: if hash unchanged, no-op
  if (current && current.contentHash === assembled.contentHash) {
    return { statusCode: 200, body: { message: 'no-op: spec unchanged' } };
  }

  await insertNewSpec(pool, {
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    ...assembled
  });

  await markStaleSdkPackages(pool, params.workspaceId, assembled.specVersion);

  await emitSpecUpdated(kafka, {
    workspaceId: params.workspaceId,
    tenantId: params.tenantId,
    specVersion: assembled.specVersion,
    previousSpecVersion: previousVersion,
    contentHash: assembled.contentHash,
    capabilityTags: assembled.capabilityTags,
    changeType: computeChangeType(previousTags, assembled.capabilityTags)
  });

  return { statusCode: 200, body: { specVersion: assembled.specVersion } };
}
```

**Acceptance**: Integration test (or unit test with mocks) verifies: capability change triggers new row in `workspace_openapi_versions`; identical capability set triggers no-op; existing SDK packages are marked stale.

---

### T4-03 · Implement sdk-builder.mjs
**File**: `SDK_BUILDER`  
**What**: Wraps `openapi-generator-cli` invocation. Runs in OpenWhisk action sandbox.

```js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import archiver from 'archiver'; // or use built-in tar

const execFileAsync = promisify(execFile);

const GENERATOR_MAP = {
  typescript: 'typescript-fetch',
  python: 'python',
};

/**
 * @param {string} specJson - OpenAPI spec as JSON string
 * @param {'typescript'|'python'} language
 * @param {string} workspaceId
 * @param {string} specVersion
 * @returns {Promise<{ archivePath: string, archiveType: 'zip'|'tar.gz' }>}
 */
export async function buildSdk(specJson, language, workspaceId, specVersion) { ... }
```

Implementation:
1. Write `specJson` to a temp file `/tmp/spec-{uuid}.json`
2. Create temp output dir `/tmp/sdk-output-{uuid}/`
3. Build generator args: `generate -g {generatorName} -i {specPath} -o {outputPath} --additional-properties packageName=workspace-{shortId}-sdk,packageVersion={specVersion}`
4. `execFileAsync('openapi-generator-cli', args, { timeout: 240_000 })`
5. Archive output: `zip` for TypeScript, `tar.gz` for Python
6. Return `{ archivePath, archiveType }`
7. Clean up temp spec file

**Acceptance**: `TEST_SDK_BUILDER` mocks `execFileAsync` and verifies: correct generator name chosen, correct CLI args constructed, timeout set. Integration test (skipped in CI without JVM) validates real SDK output structure.

---

### T4-04 · Implement sdk-storage.mjs
**File**: `SDK_STORAGE`  
**What**: S3-compatible storage adapter for SDK artefacts.

```js
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'node:fs';
import { config } from './config.mjs';

/**
 * Upload SDK archive to S3 and return a presigned download URL.
 * @param {{ archivePath: string, archiveType: string, workspaceId: string, language: string, specVersion: string }} opts
 * @returns {Promise<{ downloadUrl: string, urlExpiresAt: Date }>}
 */
export async function uploadSdkArtefact({ archivePath, archiveType, workspaceId, language, specVersion }) { ... }
```

S3 key pattern: `sdks/{workspaceId}/{language}/{specVersion}/workspace-sdk.{archiveType === 'zip' ? 'zip' : 'tar.gz'}`  
Presigned URL TTL: `config.s3PresignedUrlTtlSeconds` (default 86400s = 24h).  
`ContentType`: `application/zip` or `application/gzip`.

**Acceptance**: `TEST_SDK_STORAGE` mocks S3Client and verifies: correct key path constructed, presigned URL returned, TTL applied.

---

### T4-05 · Implement sdk-generate.mjs action
**File**: `ACTION_SDK_GEN`  
**What**: OpenWhisk action handling both:
- `POST /v1/workspaces/{id}/sdks/generate` (triggered directly by developer)
- `GET /v1/workspaces/{id}/sdks/{language}/status` (polling endpoint)

```js
export async function main(params) {
  const method = params.__ow_method?.toUpperCase();
  if (method === 'GET') return handleStatusCheck(params, pool);
  if (method === 'POST') return handleGenerateRequest(params, pool, kafka);
  return { statusCode: 405, body: { code: 'METHOD_NOT_ALLOWED' } };
}
```

`handleGenerateRequest`:
1. Parse `{ language }` from body; validate `language` ∈ `['typescript', 'python']`; return 400 otherwise
2. Get current spec from `spec-version-repo`; return 404 if none
3. `upsertSdkPackage` — if existing `ready` row for current specVersion, return 200 with download URL immediately (idempotent)
4. If new or stale: update status to `'building'`, trigger async build via self-invocation or internal OpenWhisk sequence
5. Actual build: `buildSdk(spec.formatJson, language, workspaceId, spec.specVersion)`
6. `uploadSdkArtefact(...)` → get presigned URL
7. `updateSdkPackageStatus(pool, packageId, { status: 'ready', downloadUrl, urlExpiresAt })`
8. `emitSdkGenerationCompleted(kafka, { ... status: 'ready' })`
9. Return 202 with `statusUrl`

`handleStatusCheck`:
1. `getSdkPackage(pool, workspaceId, language)` → 404 if not found
2. Auto-refresh presigned URL if within 1h of expiry
3. Return 200 with full status payload

**Acceptance**: Unit tests verify 202 response on new generate request, 200 with downloadUrl on idempotent re-request for same specVersion, 404 for unknown language or workspace, correct status response shapes.

---

## Phase 5 — APISIX Route Registration

### T5-01 · Create APISIX route fragment
**File**: `ROUTE_FRAGMENT`  
**What**: `workspace-openapi-sdk.openapi.json` — APISIX route definitions for the two new endpoints. Follow the existing pattern in `services/gateway-config/openapi-fragments/workspace-docs.openapi.json`.

Routes to register:
- `GET /v1/workspaces/{workspaceId}/openapi` → OpenWhisk action `openapi-spec-serve`
  - Auth plugins: `openid-connect` (Keycloak JWT) + `key-auth` (workspace API key)
  - Rate limit plugin: `limit-count` (configurable, default 60 req/min per workspace)
  - Cache: `proxy-cache` plugin with `Cache-Control` passthrough, max TTL 60s
- `POST /v1/workspaces/{workspaceId}/sdks/generate` → OpenWhisk action `sdk-generate`
  - Auth plugins: same as above
  - Rate limit: 10 req/min per workspace (SDK gen is expensive)
- `GET /v1/workspaces/{workspaceId}/sdks/{language}/status` → OpenWhisk action `sdk-generate`
  - Auth plugins: same
  - Rate limit: 60 req/min

**Acceptance**: Fragment is valid JSON following the structure of the existing `workspace-docs.openapi.json` fragment. No broken references.

---

## Phase 6 — Internal Contracts

### T6-01 · Write internal contract schemas
**Files**: `CONTRACT_WOV`, `CONTRACT_SDK_PKG`, `CONTRACT_SPEC_UPDATED`, `CONTRACT_SDK_COMPLETED` (in `services/internal-contracts/src/`)  
**What**: JSON Schema (draft-07) files for the four new entities. Follow the structure of existing schemas in that directory (e.g. `async-operation-state-changed.json`).

`workspace-openapi-version.json`:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "workspace-openapi-version",
  "title": "WorkspaceOpenApiVersion",
  "type": "object",
  "required": ["id","tenantId","workspaceId","specVersion","contentHash","capabilityTags","isCurrent","createdAt"],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "tenantId": { "type": "string", "format": "uuid" },
    "workspaceId": { "type": "string", "format": "uuid" },
    "specVersion": { "type": "string" },
    "contentHash": { "type": "string", "pattern": "^sha256:[0-9a-f]{64}$" },
    "capabilityTags": { "type": "array", "items": { "type": "string" } },
    "isCurrent": { "type": "boolean" },
    "createdAt": { "type": "string", "format": "date-time" }
  }
}
```

`sdk-package.json`, `openapi-spec-updated-event.json`, `sdk-generation-completed-event.json`: similar structure matching the event payloads defined in the plan's API Contracts section.

**Acceptance**: All four schemas are valid JSON Schema. `ajv` can compile each without error.

---

### T6-02 · Export new schemas from internal-contracts index
**File**: `INTERNAL_CONTRACTS_INDEX`  
**What**: Add four export lines to `services/internal-contracts/src/index.mjs` following existing export pattern:

```js
export { default as workspaceOpenApiVersion } from './workspace-openapi-version.json' assert { type: 'json' };
export { default as sdkPackage } from './sdk-package.json' assert { type: 'json' };
export { default as openapiSpecUpdatedEvent } from './openapi-spec-updated-event.json' assert { type: 'json' };
export { default as sdkGenerationCompletedEvent } from './sdk-generation-completed-event.json' assert { type: 'json' };
```

**Acceptance**: `import { workspaceOpenApiVersion } from '@falcone/internal-contracts'` resolves without error.

---

## Phase 7 — Console Frontend

### T7-01 · Implement console-openapi-sdk.ts API client
**File**: `LIB_OPENAPI_SDK`  
**What**: TypeScript API client module following the pattern of `apps/web-console/src/lib/console-workspace-docs.ts`.

```ts
// apps/web-console/src/lib/console-openapi-sdk.ts

export interface WorkspaceOpenApiSpec {
  specVersion: string;
  contentHash: string;
  format: 'json' | 'yaml';
  content: string;
  etag: string;
}

export interface SdkPackageStatus {
  packageId: string;
  language: 'typescript' | 'python';
  specVersion: string;
  status: 'pending' | 'building' | 'ready' | 'failed' | 'stale';
  downloadUrl?: string;
  urlExpiresAt?: string;
  errorMessage?: string;
}

export async function fetchWorkspaceSpec(workspaceId: string, format: 'json'|'yaml' = 'json', ifNoneMatch?: string): Promise<WorkspaceOpenApiSpec | null> { ... }

export async function downloadSpec(workspaceId: string, format: 'json'|'yaml'): Promise<void> { ... }

export async function requestSdkGeneration(workspaceId: string, language: 'typescript'|'python'): Promise<SdkPackageStatus> { ... }

export async function pollSdkStatus(workspaceId: string, language: 'typescript'|'python'): Promise<SdkPackageStatus> { ... }
```

Use `apps/web-console/src/lib/http.ts` fetch wrapper (existing) for all requests.  
`downloadSpec` triggers a browser file download using `URL.createObjectURL`.

**Acceptance**: TypeScript compiles cleanly. Unit test mocks `fetch` and verifies: 304 returns null; 200 returns parsed spec; `requestSdkGeneration` posts correct body.

---

### T7-02 · Implement SpecDownloadButton.tsx
**File**: `COMP_SPEC_DL_BTN`  
**What**: Simple reusable button component.

```tsx
interface Props {
  workspaceId: string;
  specVersion: string;
  lastUpdated: string;
}
```

- Toggle between JSON / YAML format (controlled by local state)
- Calls `downloadSpec(workspaceId, format)` on click
- Shows `specVersion` badge (e.g. `v1.2.0`) and `lastUpdated` timestamp
- Loading state during download (spinner replaces icon)
- Use existing shadcn/ui `Button` and `Badge` components

**Acceptance**: Renders without error in isolation. Vitest snapshot/interaction test verifies format toggle and download call.

---

### T7-03 · Implement OpenApiViewer.tsx
**File**: `COMP_VIEWER`  
**What**: Lazy-loads Redoc as an ES module and renders the workspace spec.

```tsx
interface Props {
  workspaceId: string;
  specVersion: string;  // used to bust cache when version changes
}
```

Implementation:
1. `const specUrl = \`/v1/workspaces/${workspaceId}/openapi?format=json\``
2. Lazy-import `redoc` using `React.lazy` + `Suspense`
3. Render `<RedocStandalone specUrl={specUrl} options={{ hideDownloadButton: true, tryItOutEnabled: true }} />`
4. Show a `ConsolePageState` loading skeleton while Redoc initialises
5. Show error boundary fallback with "Unable to load API reference" + retry button if spec fetch fails

**Acceptance**: `COMP_VIEWER_TEST` verifies: component renders with spec URL; loading state shown initially; error state shown when fetch returns 404.

---

### T7-04 · Implement SdkDownloadPanel.tsx
**File**: `COMP_SDK_PANEL`  
**What**: Language card grid with per-language SDK download state.

```tsx
interface Props {
  workspaceId: string;
  currentSpecVersion: string;
}
```

- Renders one card per supported language: `typescript`, `python`
- Polls `pollSdkStatus` every 5s while `status === 'pending' | 'building'`
- Card states:
  - `ready`: Download button (opens `downloadUrl`), version badge, size hint
  - `building`: Spinner + "Generating your SDK…"
  - `pending`: "Queued" badge + estimated wait
  - `stale`: "Regenerate" button → calls `requestSdkGeneration`
  - `failed`: Error message in red + "Retry" button + link to raw spec download
- Unsupported language section: informational card with link to openapi-generator docs
- Stop polling when component unmounts (cleanup in `useEffect`)

**Acceptance**: `COMP_SDK_PANEL_TEST` renders each card state without error; polling starts when status is `building`; polling stops on unmount.

---

### T7-05 · Implement ConsoleApiReferencePage.tsx
**File**: `PAGE_API_REF`  
**What**: Top-level page component at route `/workspaces/:workspaceId/developer/api-reference`.

Layout:
1. **Page header**: "API Reference" title + subtitle
2. **Spec Download Bar**: `<SpecDownloadButton workspaceId={id} specVersion={spec?.specVersion} lastUpdated={spec?.createdAt} />`
3. **Version change banner**: If `specVersion !== localStorage.getItem('lastSeenSpecVersion-{workspaceId}')`, show dismissable `Alert` ("API contract updated to v{specVersion}"). On dismiss, write to localStorage.
4. **Main area**: `<OpenApiViewer workspaceId={id} specVersion={spec?.specVersion} />`
5. **SDK Downloads sidebar/section**: `<SdkDownloadPanel workspaceId={id} currentSpecVersion={spec?.specVersion} />`

Auth guard: redirect to login if no workspace session.

**Acceptance**: `PAGE_API_REF_TEST` verifies: page renders correct components; version change banner appears when versions differ; banner dismisses and writes localStorage; SDK panel present.

---

## Phase 8 — Spec Docs Contracts

### T8-01 · Write specs/088 contract files
**Files**: `CONTRACT_SPEC_RESPONSE`, `CONTRACT_SDK_STATUS_RESPONSE`, `CONTRACT_SPEC_UPDATED_EVENT`, `CONTRACT_SDK_COMPLETED_EVENT`, `CONTRACT_WOV_ENTITY`, `CONTRACT_SDK_PKG_ENTITY`  
**What**: JSON Schema files documenting the API response contracts and entity shapes, as referenced in plan.md's `contracts/` directory. These are documentation artefacts — not runtime schemas.

**Acceptance**: All files are valid JSON. Content matches the API contract examples given in plan.md.

---

### T8-02 · Write data-model.md
**File**: `DATA_MODEL_DOC`  
**What**: Markdown doc describing the two new tables (`workspace_openapi_versions`, `workspace_sdk_packages`), the version increment strategy, and the row lifecycle. Cross-references the migration SQL files and the internal-contracts schemas. Follows the documentation style of other plan artefacts in the repo.

**Acceptance**: Valid Markdown. References correct file paths. Describes all columns, indexes, and lifecycle rules as specified in plan.md.

---

## Phase 9 — Unit & Integration Tests

### T9-01 · Write spec-version-repo unit tests
**File**: `TEST_VERSION_REPO`  
**What**: `node:test` tests using `pg` pool mocked via sinon or manual stub.

Test cases:
1. `getCurrentSpec` returns null for unknown workspace
2. `insertNewSpec` flips previous `is_current` to FALSE and inserts new row with `is_current = TRUE`
3. `insertNewSpec` with no existing current row inserts cleanly
4. `getSpecHistory` returns rows ordered by `created_at DESC`

**Acceptance**: All 4 test cases pass with mocked pool.

---

### T9-02 · Write sdk-builder unit tests
**File**: `TEST_SDK_BUILDER`  
**What**: `node:test` tests mocking `execFile`.

Test cases:
1. TypeScript: correct generator name `typescript-fetch`, correct `--additional-properties packageName=...`
2. Python: correct generator name `python`
3. Timeout set to 240000ms
4. Propagates error when `execFile` rejects

**Acceptance**: All 4 cases pass.

---

### T9-03 · Write sdk-storage unit tests
**File**: `TEST_SDK_STORAGE`  
**What**: `node:test` tests mocking `S3Client`.

Test cases:
1. Upload path follows `sdks/{workspaceId}/{language}/{specVersion}/workspace-sdk.zip` pattern
2. Presigned URL TTL matches `config.s3PresignedUrlTtlSeconds`
3. `urlExpiresAt` is approximately `now + TTL`
4. Python archive uses `.tar.gz` extension and `application/gzip` content type

**Acceptance**: All 4 cases pass.

---

### T9-04 · Write spec-cache unit tests
**File**: `TEST_SPEC_CACHE`  
**What**: `node:test` tests — no mocking needed (pure functions).

Test cases:
1. `computeContentHash` returns deterministic `sha256:{64hex}` for same input
2. Different input → different hash
3. `etagFromHash` wraps hash in double-quotes
4. `isEtagMatch` returns true when `If-None-Match` equals ETag
5. `isEtagMatch` returns false on mismatch or wildcard `*`

**Acceptance**: All 5 cases pass.

---

### T9-05 · Write openapi-spec-serve action tests
**File**: `TEST_ACTION_SERVE`  
**What**: `node:test` tests with all I/O mocked (pool, kafka).

Test cases:
1. Returns 200 JSON with ETag and `X-Spec-Version` headers when spec exists
2. Returns 200 YAML when `format=yaml` query param
3. Returns 304 when `If-None-Match` matches current content hash
4. Returns 404 when no spec exists for workspace
5. Returns 401 when auth headers missing
6. Returns 403 when `tenantId` in headers does not match workspace tenant
7. Returns 429 when rate limit exceeded (mock rate limiter)

**Acceptance**: All 7 cases pass.

---

## Phase 10 — CI Integration

### T10-01 · Add spectral lint script
**What**: Add `"lint:openapi"` script to `services/openapi-sdk-service/package.json` and a `.spectral.yaml` at the service root using the `@stoplight/spectral-rulesets` oas ruleset. Register this script to run in CI after spec generation tests.

```yaml
# services/openapi-sdk-service/.spectral.yaml
extends: ["@stoplight/spectral-rulesets/oas"]
rules:
  oas3-valid-media-example: error
  no-$ref-siblings: error
```

**Acceptance**: `pnpm --filter @falcone/openapi-sdk-service lint:openapi` runs spectral; fails on a deliberately broken fragment; passes on all valid fragments.

---

### T10-02 · Add SDK contract validation scripts
**What**: Add two validation scripts to `services/openapi-sdk-service/package.json`:
- `"validate:sdk:ts"`: `tsc --noEmit -p /tmp/test-sdk-ts/tsconfig.json` (post-SDK-gen)
- `"validate:sdk:python"`: `python3 -m py_compile /tmp/test-sdk-python/**/*.py` (post-SDK-gen)

These are invoked in the integration test for the SDK generation lifecycle (not in unit test run).

**Acceptance**: Scripts are defined; integration test documentation notes these as post-gen validation steps.

---

## Task Summary & Sequencing

```
Phase 0 (scaffolding):      T0-01, T0-02, T0-03          [parallel]
Phase 1 (DDL):              T1-01, T1-02                  [parallel, after T0]
Phase 2 (core modules):     T2-01, T2-02, T2-03, T2-04, T2-05  [parallel, after T1]
Phase 3 (assembler):        T3-01 → T3-02 → T3-03 → T3-04 → T3-05  [sequential]
Phase 4 (actions):          T4-01, T4-02 [after T2+T3]; T4-03, T4-04 [parallel]; T4-05 [after T4-03+T4-04]
Phase 5 (gateway):          T5-01  [after T4-01]
Phase 6 (contracts):        T6-01, T6-02  [parallel, after T3-04]
Phase 7 (frontend):         T7-01 → T7-02, T7-03, T7-04 [parallel] → T7-05
Phase 8 (spec docs):        T8-01, T8-02  [parallel, any time]
Phase 9 (tests):            T9-01…T9-05  [after respective Phase 2+4 tasks]
Phase 10 (CI):              T10-01, T10-02  [after T3-05, T4-05]
```

**Critical path**: T0-01 → T1-01 → T2-01 → T3-04 → T4-01 → T5-01

**Parallelisable after Phase 1 stabilises**: Phase 3+4 (backend) can run in parallel with Phase 7 (frontend) once `ACTION_SERVE` provides a stable mock or real endpoint.

---

## Done Criteria Reference

All done criteria from plan.md (CD-001 through CD-013) must be verified before this feature is considered complete. The implement step will validate each criterion as part of the integration test suite.

| Criterion | Tasks covering it |
|-----------|------------------|
| CD-001 Valid spec served | T4-01, T9-05 |
| CD-002 Disabled paths absent | T3-04, T3-05 |
| CD-003 ETag/304 | T2-04, T4-01, T9-04, T9-05 |
| CD-004 Spec regeneration <2min | T4-02 |
| CD-005 TypeScript SDK compiles | T4-03, T10-02 |
| CD-006 Python SDK compiles | T4-03, T10-02 |
| CD-007 SDK idempotency | T2-02, T4-05 |
| CD-008 Interactive reference renders | T7-03, T7-05 |
| CD-009 Audit trail | T2-05, T4-01 |
| CD-010 Access control | T4-01, T9-05 |
| CD-011 Rate limiting | T5-01, T9-05 |
| CD-012 SDK failure surfaces | T4-05, T7-04 |
| CD-013 Prometheus metrics | T4-01, T4-05 (add histogram instrumentation) |
