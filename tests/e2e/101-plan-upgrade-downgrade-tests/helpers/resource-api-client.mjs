import assert from 'node:assert/strict';
import { assertResourceResponseUnchanged } from './assertion-helpers.mjs';

const DEFAULT_PATHS = {
  max_workspaces: '/v1/tenants/{tenantId}/workspaces',
  max_postgres_databases: '/v1/tenants/{tenantId}/postgres-databases',
  max_mongo_databases: '/v1/tenants/{tenantId}/mongo-databases',
  max_kafka_topics: '/v1/tenants/{tenantId}/kafka-topics',
  max_functions: '/v1/tenants/{tenantId}/functions',
  max_storage_bytes: '/v1/tenants/{tenantId}/storage-objects',
  max_api_keys: '/v1/tenants/{tenantId}/api-keys',
  max_members: '/v1/tenants/{tenantId}/members'
};

function apiBaseUrl() {
  if (!process.env.TEST_API_BASE_URL) throw new Error('TEST_API_BASE_URL is required');
  return process.env.TEST_API_BASE_URL.replace(/\/$/, '');
}

function headers(token, extra = {}) {
  return { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra };
}

function resourcePaths() {
  const override = process.env.TEST_RESOURCE_PATHS_JSON;
  if (!override) return DEFAULT_PATHS;
  return { ...DEFAULT_PATHS, ...JSON.parse(override) };
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function pathFor(dimensionKey, tenantId) {
  const path = resourcePaths()[dimensionKey];
  assert.ok(path, `No resource API path configured for dimension ${dimensionKey}`);
  return path.replaceAll('{tenantId}', tenantId);
}

export async function listResources(dimensionKey, tenantId, token) {
  const response = await fetch(`${apiBaseUrl()}${pathFor(dimensionKey, tenantId)}`, { method: 'GET', headers: headers(token) });
  const body = await parseBody(response);
  return { status: response.status, body, items: Array.isArray(body) ? body : (body?.items ?? body?.data ?? []) };
}

export async function snapshotAllResources(tenantId, token, dimensionKeys = Object.keys(resourcePaths())) {
  const snapshot = new Map();
  for (const dimensionKey of dimensionKeys) {
    const result = await listResources(dimensionKey, tenantId, token);
    snapshot.set(dimensionKey, result.items);
  }
  return snapshot;
}

export function assertResourcesUnchanged(snapshotBefore, snapshotAfter) {
  for (const [dimensionKey, itemsBefore] of snapshotBefore.entries()) {
    assert.ok(snapshotAfter.has(dimensionKey), `Missing snapshot for ${dimensionKey}`);
    assertResourceResponseUnchanged(itemsBefore, snapshotAfter.get(dimensionKey));
  }
  return true;
}

export function countPerDimension(snapshot) {
  return new Map([...snapshot.entries()].map(([key, items]) => [key, Array.isArray(items) ? items.length : 0]));
}

export async function createResource(dimensionKey, tenantId, token, payload) {
  const response = await fetch(`${apiBaseUrl()}${pathFor(dimensionKey, tenantId)}`, {
    method: 'POST',
    headers: headers(token, { 'content-type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  return { status: response.status, body: await parseBody(response) };
}

export async function deleteResource(dimensionKey, tenantId, token, item) {
  const template = `${pathFor(dimensionKey, tenantId)}/{resourceId}`;
  const resourceId = item?.id ?? item?.resourceId ?? item?.key ?? item?.name;
  if (!resourceId) return { status: 204, body: null };
  const response = await fetch(`${apiBaseUrl()}${template.replace('{resourceId}', resourceId)}`, { method: 'DELETE', headers: headers(token) });
  return { status: response.status, body: await parseBody(response) };
}
