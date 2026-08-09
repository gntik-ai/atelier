import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { computeContentHash } from './spec-cache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const moduleCache = new Map();
const CAPABILITY_MODULES = {
  authentication: 'capability-modules/auth.paths.json',
  storage: 'capability-modules/storage.paths.json',
  functions: 'capability-modules/functions.paths.json',
  realtime: 'capability-modules/realtime.paths.json',
  mongodb: 'capability-modules/mongodb.paths.json',
  postgresql: 'capability-modules/postgresql.paths.json',
  events: 'capability-modules/events.paths.json'
};

function loadJson(relativePath) {
  if (!moduleCache.has(relativePath)) {
    const fullPath = path.join(__dirname, relativePath);
    moduleCache.set(relativePath, JSON.parse(readFileSync(fullPath, 'utf8')));
  }
  return moduleCache.get(relativePath);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyPublicTraceHeaders(spec) {
  const methods = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
  for (const pathItem of Object.values(spec.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!methods.has(method) || !operation || typeof operation !== 'object') continue;
      operation.parameters ??= [];
      operation.parameters.unshift(
        { $ref: '#/components/parameters/XApiVersion' },
        { $ref: '#/components/parameters/XCorrelationId' }
      );
      for (const response of Object.values(operation.responses ?? {})) {
        if (!response || typeof response !== 'object' || '$ref' in response) continue;
        response.headers ??= {};
        response.headers['X-Correlation-Id'] ??= { $ref: '#/components/headers/XCorrelationId' };
      }
    }
  }
}

function bump(version, index) {
  const parts = version.split('.').map((item) => Number(item) || 0).slice(0, 3);
  while (parts.length < 3) parts.push(0);
  parts[index] += 1;
  for (let i = index + 1; i < parts.length; i += 1) parts[i] = 0;
  return parts.join('.');
}

export function computeNextVersion(previousVersion = '0.0.0', previousTags = [], newTags = []) {
  const prev = [...new Set(previousTags)].sort();
  const next = [...new Set(newTags)].sort();
  const removed = prev.some((tag) => !next.includes(tag));
  const added = next.some((tag) => !prev.includes(tag));
  if (removed) return bump(previousVersion, 0);
  if (added) return bump(previousVersion, 1);
  return bump(previousVersion, 2);
}

export function computeChangeType(previousTags = [], newTags = []) {
  const prev = [...new Set(previousTags)].sort();
  const next = [...new Set(newTags)].sort();
  if (prev.some((tag) => !next.includes(tag))) return 'MAJOR';
  if (next.some((tag) => !prev.includes(tag))) return 'MINOR';
  return 'PATCH';
}

export function assembleSpec({ enabledCapabilities, workspaceBaseUrl, previousSpecVersion = '0.0.0', previousCapabilityTags = [] }) {
  const spec = clone(loadJson('capability-modules/base-template.openapi.json'));
  const capabilityTags = [...enabledCapabilities].sort();

  for (const capability of capabilityTags) {
    const relativePath = CAPABILITY_MODULES[capability];
    if (!relativePath) continue;
    const module = clone(loadJson(relativePath));
    spec.paths = { ...spec.paths, ...module.paths };
    spec.components.schemas = { ...spec.components.schemas, ...(module.components?.schemas ?? {}) };
    spec.tags.push(module.tag);
  }
  applyPublicTraceHeaders(spec);

  const specVersion = computeNextVersion(previousSpecVersion, previousCapabilityTags, capabilityTags);
  spec.info.version = specVersion;
  spec.servers[0].url = workspaceBaseUrl;

  const formatJson = JSON.stringify(spec, null, 2);
  const formatYaml = yaml.dump(spec);
  const contentHash = computeContentHash(formatJson);

  return { formatJson, formatYaml, contentHash, specVersion, capabilityTags };
}
