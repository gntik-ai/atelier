// C-08 platform discovery + billing read handlers (kind deploy).
//
// The final C-08 read family: the two durable billing usage reads and the three
// platform discovery reads (route catalog, storage-provider introspection,
// topology regions). Aggregated with the observability / Function-audit /
// tenant-dashboard families by c08-handlers.mjs.
//
// All five operations are platform-scoped (audiences platform_team / superadmin);
// the route table authenticates the caller and each handler then asserts platform scope before any
// backend access. Reads are side-effect-free and never expose secrets; billing is
// tenant-filtered by the durable repository; discovery reads project the canonical
// generated/runtime configuration sources.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  buildStorageProviderProfile,
  DEFAULT_STORAGE_PROVIDER_TYPE
} from '../../packages/adapters/src/storage-provider-profile.mjs';
import { validateC08Schema } from './c08-contracts.mjs';
import { isPlatformTeam } from './c08-authz.mjs';

const ok = (statusCode, body) => ({ statusCode, body });
const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });

function contractual(schema, body) {
  const validation = validateC08Schema(schema, body);
  if (!validation.valid) {
    throw Object.assign(new Error(`${schema} projection violates OpenAPI`), {
      code: 'C08_OUTPUT_CONTRACT_VIOLATION', validationErrors: validation.errors
    });
  }
  return ok(200, body);
}

// ---- platform read gate ------------------------------------------------------
export function isPlatformActor(identity) {
  return isPlatformTeam(identity) || identity?.actorType === 'internal';
}
function requirePlatform(ctx) {
  return isPlatformActor(ctx.identity) ? null : err(403, 'FORBIDDEN', 'requires platform scope');
}

// =============================================================================
// Billing usage reads — durable billing_usage_records via packages/billing-export
// =============================================================================
let _billingQuery = null;
async function loadBillingQuery() {
  if (_billingQuery) return _billingQuery;
  const candidates = [
    '/repo/packages/billing-export/src/query-handler.mjs',
    new URL('../../packages/billing-export/src/query-handler.mjs', import.meta.url).href
  ];
  for (const c of candidates) {
    try { const m = await import(c); if (typeof m.main === 'function') { _billingQuery = m; return m; } }
    catch { /* try next */ }
  }
  return null;
}
function billingPaging(ctx) {
  const rawSize = catalogQueryValue(ctx, 'page[size]');
  const rawAfter = catalogQueryValue(ctx, 'page[after]');
  return {
    pageSize: rawSize == null ? undefined : Number(rawSize),
    pageAfter: rawAfter == null ? undefined : String(rawAfter)
  };
}
async function runBilling(ctx, params) {
  const mod = await loadBillingQuery();
  if (!mod) return err(500, 'BILLING_SOURCE_UNAVAILABLE', 'billing usage source is not available');
  try {
    const result = await mod.main({ ...params, callerContext: ctx.callerContext }, { db: ctx.pool });
    if ((result.statusCode ?? 200) === 200) return contractual('BillingUsageRecordList', result.body);
    return ok(result.statusCode, result.body);
  } catch (e) {
    const status = Number(e?.statusCode);
    if (status === 403) return err(403, e.code ?? 'FORBIDDEN', e.message ?? 'forbidden');
    if (status >= 400 && status < 500) return err(status, e.code ?? 'BILLING_QUERY_FAILED', e.message ?? 'billing query failed');
    throw e;
  }
}
async function listBillingUsageRecords(ctx) {
  const authorization = requirePlatform(ctx);
  if (authorization) return authorization;
  return runBilling(ctx, billingPaging(ctx));
}
async function listTenantBillingUsageRecords(ctx) {
  const authorization = requirePlatform(ctx);
  if (authorization) return authorization;
  const tenantId = String(ctx.params.tenantId);
  if (!/^ten_[0-9a-z]+$/.test(tenantId)) return err(400, 'INVALID_IDENTIFIER', 'tenantId must match ^ten_[0-9a-z]+$');
  const tenant = await ctx.pool.query('SELECT id FROM tenants WHERE id = $1 LIMIT 1', [tenantId]);
  if (!tenant.rows[0]) return err(404, 'TENANT_NOT_FOUND', `tenant ${tenantId} not found`);
  return runBilling(ctx, { ...billingPaging(ctx), tenantId });
}

// =============================================================================
// Route catalog / topology regions — canonical internal-contracts sources
// =============================================================================
async function readContractJson(relPath) {
  const candidates = [
    process.env.REPO_ROOT ? resolve(process.env.REPO_ROOT, relPath) : null,
    resolve('/repo', relPath),
    new URL(`../../${relPath}`, import.meta.url)
  ].filter(Boolean);
  let lastErr = null;
  for (const c of candidates) {
    try { return JSON.parse(await readFile(c, 'utf8')); }
    catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error(`cannot resolve ${relPath}`);
}
const ROUTE_CATALOG_ENTRY_FIELDS = Object.freeze([
  'family', 'method', 'path', 'operationId', 'summary', 'scope', 'visibility', 'audiences',
  'authRequired', 'requiredHeaders', 'downstreamService', 'gatewayQosProfile',
  'gatewayRequestValidationProfile', 'gatewayTimeoutProfile', 'gatewayRetryProfile',
  'maxRequestBodyBytes', 'allowedContentTypes', 'correlationIdRequired',
  'correlationIdGeneratedWhenMissing', 'internalRequestMode', 'errorEnvelope', 'qosBurst'
]);

const ROUTE_CATALOG_SORT_FIELDS = new Set(['operationId', 'family', 'path', 'method', 'summary']);

function catalogQueryValue(ctx, name) {
  if (ctx.searchParams?.get) return ctx.searchParams.get(name);
  const value = ctx.query?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function catalogRequest(ctx) {
  const rawSize = catalogQueryValue(ctx, 'page[size]');
  const size = rawSize == null ? 25 : Number(rawSize);
  const rawSort = catalogQueryValue(ctx, 'sort') ?? 'operationId';
  const descending = String(rawSort).startsWith('-');
  const sort = descending ? String(rawSort).slice(1) : String(rawSort);
  const search = catalogQueryValue(ctx, 'search');
  const filters = {
    family: catalogQueryValue(ctx, 'family'),
    scope: catalogQueryValue(ctx, 'scope'),
    resourceType: catalogQueryValue(ctx, 'resourceType'),
    method: catalogQueryValue(ctx, 'method'),
    audience: catalogQueryValue(ctx, 'audience'),
    visibility: catalogQueryValue(ctx, 'visibility')
  };
  if (!Number.isInteger(size) || size < 1 || size > 200) return null;
  if (!ROUTE_CATALOG_SORT_FIELDS.has(sort)) return null;
  if (search != null && (String(search).length < 1 || String(search).length > 120)) return null;
  if (filters.resourceType != null && (String(filters.resourceType).length < 2 || String(filters.resourceType).length > 80)) return null;
  for (const [name, value] of Object.entries(filters)) {
    if (value != null && String(value).length === 0) return null;
    filters[name] = value == null ? null : String(value);
  }
  const signature = createHash('sha256').update(JSON.stringify({ sort, descending, search: search ?? null, filters })).digest('base64url');
  const rawAfter = catalogQueryValue(ctx, 'page[after]');
  let offset = 0;
  if (rawAfter != null) {
    try {
      const cursor = JSON.parse(Buffer.from(String(rawAfter), 'base64url').toString('utf8'));
      if (cursor?.v !== 1 || !Number.isInteger(cursor.offset) || cursor.offset < 0 || cursor.signature !== signature) return null;
      offset = cursor.offset;
    } catch { return null; }
  }
  return { size, sort, descending, search: search == null ? null : String(search).toLowerCase(), filters, signature, offset, rawAfter };
}

function catalogPage(routes, request) {
  const filtered = routes.filter((route) => {
    for (const [name, value] of Object.entries(request.filters)) {
      if (value == null) continue;
      if (name === 'audience') {
        if (!(route.audiences ?? []).includes(value)) return false;
      } else if (route[name] !== value) return false;
    }
    if (request.search) {
      const haystack = [route.operationId, route.summary, route.path, route.family, route.resourceType]
        .filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(request.search)) return false;
    }
    return true;
  });
  filtered.sort((left, right) => {
    const primary = String(left[request.sort] ?? '').localeCompare(String(right[request.sort] ?? ''));
    const stable = primary || String(left.operationId).localeCompare(String(right.operationId));
    return request.descending ? -stable : stable;
  });
  const items = filtered.slice(request.offset, request.offset + request.size);
  const page = { size: request.size };
  if (request.rawAfter != null) page.after = String(request.rawAfter);
  if (request.offset + items.length < filtered.length) {
    page.nextCursor = Buffer.from(JSON.stringify({
      v: 1, offset: request.offset + items.length, signature: request.signature
    })).toString('base64url');
  }
  return { items, page };
}

async function getRouteCatalog(ctx) {
  const az = requirePlatform(ctx);
  if (az) return az;
  const request = catalogRequest(ctx);
  if (!request) return err(400, 'INVALID_QUERY', 'invalid route catalog query');
  const catalog = await readContractJson('packages/internal-contracts/src/public-route-catalog.json');
  const projected = (catalog.routes ?? []).map((route) => {
    const entry = {};
    for (const field of ROUTE_CATALOG_ENTRY_FIELDS) entry[field] = route[field];
    return entry;
  });
  const { items, page } = catalogPage(projected, request);
  return contractual('RouteCatalogResponse', {
    version: catalog.version ?? 'unknown',
    generatedFrom: catalog.generatedFrom ?? 'public-route-catalog',
    page,
    items
  });
}
async function listTopologyRegions(ctx) {
  const az = requirePlatform(ctx);
  if (az) return az;
  const topology = await readContractJson('packages/internal-contracts/src/deployment-topology.json');
  const regions = Array.isArray(topology.supported_regions) ? topology.supported_regions.map(String) : [];
  return contractual('TopologyRegionsResponse', { regions });
}

// =============================================================================
// Storage provider introspection — canonical adapter profile (no secrets)
// =============================================================================
async function getStorageProviderIntrospection(ctx) {
  const az = requirePlatform(ctx);
  if (az) return az;
  const profile = buildStorageProviderProfile({
    providerType: process.env.STORAGE_DEFAULT_PROVIDER_TYPE ?? DEFAULT_STORAGE_PROVIDER_TYPE
  });
  return contractual('StorageProviderIntrospection', profile);
}

export const PLATFORM_DISCOVERY_HANDLERS = {
  listBillingUsageRecords,
  listTenantBillingUsageRecords,
  getRouteCatalog,
  getStorageProviderIntrospection,
  listTopologyRegions
};
