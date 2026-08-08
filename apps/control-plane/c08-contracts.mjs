// Runtime validation for the C-08 public operations.
//
// The unified OpenAPI is the source of truth for request and response shapes.  Loading
// schemas from that document avoids a second hand-maintained validator drifting from the
// generated clients/catalog.  The image carries the same document under /repo.
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';

const OPENAPI_CANDIDATES = Object.freeze([
  '/repo/apps/control-plane-executor/openapi/control-plane.openapi.json',
  new URL('../control-plane-executor/openapi/control-plane.openapi.json', import.meta.url)
]);

let validators = null;

function readOpenApi() {
  let lastError = null;
  for (const candidate of OPENAPI_CANDIDATES) {
    try {
      return JSON.parse(readFileSync(candidate, 'utf8'));
    } catch (error) {
      lastError = error;
    }
  }
  throw Object.assign(new Error('C-08 OpenAPI contract is unavailable'), {
    code: 'C08_CONTRACT_UNAVAILABLE',
    cause: lastError
  });
}

function validatorRegistry() {
  if (validators) return validators;
  const document = readOpenApi();
  const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
  ajv.addFormat('date-time', (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)));
  ajv.addFormat('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  ajv.addSchema(document, 'falcone-control-plane');
  validators = { ajv, document, compiled: new Map() };
  return validators;
}

export function validateC08Schema(schemaName, value) {
  const registry = validatorRegistry();
  let validate = registry.compiled.get(schemaName);
  if (!validate) {
    validate = registry.ajv.getSchema(`falcone-control-plane#/components/schemas/${schemaName}`);
    if (!validate) throw Object.assign(new Error(`OpenAPI schema ${schemaName} is missing`), { code: 'C08_SCHEMA_MISSING' });
    registry.compiled.set(schemaName, validate);
  }
  const valid = Boolean(validate(value));
  return {
    valid,
    errors: valid ? [] : (validate.errors ?? []).map((entry) => ({
      path: entry.instancePath || '/',
      keyword: entry.keyword,
      message: entry.message ?? 'invalid value'
    }))
  };
}

export function compactValidationMessage(errors = []) {
  return errors.slice(0, 5).map((error) => `${error.path} ${error.message}`).join('; ');
}

// Entity metadata is explicitly non-secret.  Reject well-known credential key names
// rather than persisting a value that happens to satisfy the generic string schema.
const SENSITIVE_METADATA_KEY = /(?:^|[_\-.])(password|passwd|secret|token|credential|private[_-]?key|api[_-]?key)(?:$|[_\-.])/i;

export function metadataContainsSensitiveKey(metadata) {
  return metadata && typeof metadata === 'object'
    ? Object.keys(metadata).some((key) => SENSITIVE_METADATA_KEY.test(key))
    : false;
}

export function resetC08ContractCacheForTests() {
  validators = null;
}
