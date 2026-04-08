import { readFileSync } from 'node:fs';
import YAML from 'yaml';

export const OPENAPI_PATH = 'apps/control-plane/openapi/control-plane.openapi.json';
export const IMAGE_VALUES_PATH = 'charts/in-falcone/values.yaml';

const HTTP_METHODS = new Set(['get', 'put', 'post', 'patch', 'delete', 'options', 'head']);
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const IMAGE_TAG_PATTERN = /^\d+\.\d+\.\d+(?:[-._][0-9A-Za-z]+)*$/;

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function readYaml(filePath) {
  return YAML.parse(readFileSync(filePath, 'utf8'));
}

export function resolveLocalRef(document, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    return null;
  }

  return ref
    .slice(2)
    .split('/')
    .reduce((value, segment) => value?.[segment], document);
}

export function resolveParameters(document, operation = {}) {
  return (operation.parameters ?? []).map((parameter) => {
    if (parameter?.$ref) {
      return resolveLocalRef(document, parameter.$ref) ?? parameter;
    }

    return parameter;
  });
}

export function isSemver(value) {
  return typeof value === 'string' && SEMVER_PATTERN.test(value);
}

export function listOperations(document) {
  return Object.entries(document.paths ?? {}).flatMap(([path, pathItem]) => {
    if (!pathItem || typeof pathItem !== 'object') return [];

    return Object.entries(pathItem)
      .filter(([method]) => HTTP_METHODS.has(method))
      .map(([method, operation]) => ({
        path,
        method,
        operation: operation ?? {}
      }));
  });
}

export function collectContractViolations(document) {
  const violations = [];

  if (!isSemver(document?.info?.version)) {
    violations.push(`OpenAPI info.version must be semver; received ${String(document?.info?.version)}`);
  }

  const errorSchema = document?.components?.schemas?.ErrorResponse;
  const requiredErrorFields = ['status', 'code', 'message', 'detail', 'requestId', 'correlationId', 'timestamp', 'resource'];
  for (const field of requiredErrorFields) {
    if (!(errorSchema?.required ?? []).includes(field)) {
      violations.push(`OpenAPI ErrorResponse must require field ${field}.`);
    }
  }

  for (const { path, method, operation } of listOperations(document)) {
    const operationLabel = `${method.toUpperCase()} ${path}`;

    if (!operation.operationId) {
      violations.push(`${operationLabel} is missing operationId.`);
    }

    if (path !== '/health' && !path.startsWith('/v1/')) {
      violations.push(`${operationLabel} must use the /v1/ URI prefix for the current contract generation.`);
    }

    if (path !== '/health') {
      const parameters = resolveParameters(document, operation);
      const versionHeader = parameters.find(
        (parameter) =>
          parameter?.in === 'header' && parameter?.name === 'X-API-Version' && parameter?.required === true
      );

      if (!versionHeader) {
        violations.push(`${operationLabel} must require the X-API-Version header.`);
      }

      const correlationHeader = parameters.find(
        (parameter) =>
          parameter?.in === 'header' && parameter?.name === 'X-Correlation-Id' && parameter?.required === true
      );

      if (!correlationHeader) {
        violations.push(`${operationLabel} must require the X-Correlation-Id header.`);
      }

      const responseCodes = Object.keys(operation.responses ?? {});
      const hasErrorContract = responseCodes.some(
        (status) => status === 'default' || /^4\d\d$/.test(status) || /^5\d\d$/.test(status)
      );

      if (!hasErrorContract) {
        violations.push(`${operationLabel} must declare at least one 4xx/5xx/default error response contract.`);
      }

      if (!responseCodes.includes('403')) {
        violations.push(`${operationLabel} must declare a 403 authorization error response.`);
      }

      for (const status of ['429', '431', '504']) {
        if (!responseCodes.includes(status)) {
          violations.push(`${operationLabel} must declare gateway resilience response ${status}.`);
        }
      }

      if ((operation.requestBody || ['post', 'put', 'patch', 'delete'].includes(method)) && !responseCodes.includes('413')) {
        violations.push(`${operationLabel} must declare oversized-body response 413.`);
      }
    }
  }

  return violations;
}

export function collectImageTargets(values) {
  return Object.entries(values ?? {})
    .filter(([, section]) => section && typeof section === 'object' && 'image' in section)
    .map(([name, section]) => ({
      name,
      image: section.image ?? {},
      enabled: section.enabled !== false
    }));
}

export function validateImagePolicy(values) {
  const violations = [];

  for (const target of collectImageTargets(values)) {
    if (!target.enabled) continue;

    const repository = target.image.repository;
    const tag = target.image.tag;
    const digest = target.image.digest;

    if (!repository || typeof repository !== 'string') {
      violations.push(`${target.name} must define image.repository.`);
    }

    if (!tag && !digest) {
      violations.push(`${target.name} must define an immutable image tag or digest.`);
      continue;
    }

    if (typeof tag === 'string' && tag.toLowerCase() === 'latest') {
      violations.push(`${target.name} image tag must not use the mutable 'latest' tag.`);
    }

    if (typeof tag === 'string' && tag && !IMAGE_TAG_PATTERN.test(tag)) {
      violations.push(
        `${target.name} image tag must be semver-like (for example 0.1.0 or 0.1.0-rc1); received ${tag}.`
      );
    }

    if (digest && (typeof digest !== 'string' || !digest.startsWith('sha256:'))) {
      violations.push(`${target.name} image digest must use sha256:... format when provided.`);
    }
  }

  return violations;
}
