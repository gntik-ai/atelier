import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const KNATIVE_STATUS_SCHEMA = 'falcone.knative-runtime/v1';
export const SUPPORTED_KNATIVE_VERSION = '1.22.1';
export const DEFAULT_KNATIVE_STATUS_FILE = '/var/run/falcone/knative/status.json';

const MODES = new Set(['managed', 'external', 'disabled']);
const COMPATIBILITY = new Set(['compatible', 'incompatible', 'unverified']);
const READINESS = new Set(['ready', 'unverified', 'degraded', 'unavailable', 'disabled']);
const STAGES = new Set([
  'configured', 'preflight', 'crds', 'webhook', 'serving', 'kourier', 'smoke', 'ready',
  'disabled', 'external_validation', 'unknown',
]);
const EXTERNAL_CANARY_STATES = new Set(['verified', 'missing', 'unreadable', 'invoke_failed']);
const MAX_STATUS_BYTES = 16 * 1024;
const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,126}$/;
const SAFE_REASON = /^[A-Z][A-Z0-9_]{0,63}$/;

function strictBoolean(value, name, fallback) {
  if (value == null || value === '') return fallback;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  throw new Error(`${name} must be one of true, false, 1, or 0`);
}

export function parseKnativeRuntimeConfig(env = process.env) {
  const mode = env.KNATIVE_RUNTIME_MODE == null || env.KNATIVE_RUNTIME_MODE === ''
    ? 'disabled'
    : env.KNATIVE_RUNTIME_MODE;
  if (!MODES.has(mode)) {
    throw new Error('KNATIVE_RUNTIME_MODE must be exactly managed, external, or disabled');
  }
  const statusFile = env.KNATIVE_RUNTIME_STATUS_FILE == null || env.KNATIVE_RUNTIME_STATUS_FILE === ''
    ? DEFAULT_KNATIVE_STATUS_FILE
    : env.KNATIVE_RUNTIME_STATUS_FILE;
  if (typeof statusFile !== 'string' || !statusFile.startsWith('/') || statusFile.length > 1024) {
    throw new Error('KNATIVE_RUNTIME_STATUS_FILE must be an absolute path of at most 1024 characters');
  }
  return {
    mode,
    statusFile,
    functionsEnabled: strictBoolean(env.FUNCTIONS_ENABLED, 'FUNCTIONS_ENABLED', true),
  };
}

function disabledStatus() {
  return {
    mode: 'disabled', owner: 'none', version: null, compatibility: 'unverified', state: 'disabled',
    stage: 'disabled', reason: 'RUNTIME_DISABLED', lastTransitionAt: null,
  };
}

function unavailableStatus(mode, reason) {
  return {
    mode,
    owner: 'unknown',
    version: null,
    compatibility: 'unverified',
    state: mode === 'external' ? 'unverified' : 'unavailable',
    stage: mode === 'external' ? 'external_validation' : 'unknown',
    reason,
    lastTransitionAt: null,
  };
}

function validTimestamp(value) {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function assertStatusDocument(document, configuredMode) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('status document must be an object');
  }
  if (document.schemaVersion !== KNATIVE_STATUS_SCHEMA) throw new Error('unsupported status schema');
  if (!MODES.has(document.mode)) throw new Error('invalid status mode');
  if (document.mode !== configuredMode) {
    return unavailableStatus(configuredMode, 'STATUS_MODE_MISMATCH');
  }
  if (document.mode === 'disabled') return disabledStatus();
  if (typeof document.owner !== 'string' || !SAFE_NAME.test(document.owner)) throw new Error('invalid owner');
  if (typeof document.version !== 'string' || !SAFE_NAME.test(document.version)) throw new Error('invalid version');
  if (!COMPATIBILITY.has(document.compatibility)) throw new Error('invalid compatibility');
  const readiness = document.readiness;
  if (!readiness || typeof readiness !== 'object' || Array.isArray(readiness)) throw new Error('invalid readiness');
  if (!READINESS.has(readiness.state) || readiness.state === 'disabled') throw new Error('invalid readiness state');
  if (!STAGES.has(readiness.stage)) throw new Error('invalid readiness stage');
  if (!SAFE_REASON.test(readiness.reason ?? '')) throw new Error('invalid readiness reason');
  if (!validTimestamp(readiness.lastTransitionAt)) throw new Error('invalid transition timestamp');

  const status = {
    mode: document.mode,
    owner: document.owner,
    version: document.version,
    compatibility: document.compatibility,
    state: readiness.state,
    stage: readiness.stage,
    reason: readiness.reason,
    lastTransitionAt: new Date(readiness.lastTransitionAt).toISOString(),
  };

  if (document.version !== SUPPORTED_KNATIVE_VERSION) {
    return { ...status, compatibility: 'incompatible', state: 'unavailable', reason: 'VERSION_UNSUPPORTED' };
  }
  if (document.compatibility !== 'compatible' && document.readiness.state === 'ready') {
    return { ...status, state: document.mode === 'external' ? 'unverified' : 'unavailable', reason: 'COMPATIBILITY_UNVERIFIED' };
  }
  if (document.mode === 'external') {
    const canaryState = document.externalCanary?.state;
    if (!EXTERNAL_CANARY_STATES.has(canaryState)) {
      return { ...status, state: 'unverified', reason: 'EXTERNAL_CANARY_MISSING' };
    }
    if (canaryState !== 'verified') {
      const reason = canaryState === 'missing' ? 'EXTERNAL_CANARY_MISSING'
        : canaryState === 'unreadable' ? 'EXTERNAL_CANARY_UNREADABLE'
          : 'EXTERNAL_CANARY_INVOKE_FAILED';
      return { ...status, state: 'unverified', reason };
    }
  }
  return status;
}

export function createKnativeRuntimeSource({
  env = process.env,
  readFile = (path) => readFileSync(path, 'utf8'),
} = {}) {
  const config = parseKnativeRuntimeConfig(env);

  function status() {
    if (config.mode === 'disabled') return disabledStatus();
    let raw;
    try {
      raw = readFile(config.statusFile);
    } catch {
      return unavailableStatus(config.mode, 'STATUS_FILE_UNAVAILABLE');
    }
    try {
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
      if (Buffer.byteLength(text) > MAX_STATUS_BYTES) throw new Error('status file too large');
      return assertStatusDocument(JSON.parse(text), config.mode);
    } catch {
      return unavailableStatus(config.mode, 'STATUS_FILE_INVALID');
    }
  }

  return Object.freeze({
    mode: config.mode,
    statusFile: config.statusFile,
    functionsEnabled: config.functionsEnabled,
    status,
    canServeWorkloads: (snapshot = null) => (snapshot ?? status()).state === 'ready',
  });
}

export function knativeUnavailableResponse(runtimeStatus, correlationId = randomUUID()) {
  return {
    code: 'KNATIVE_UNAVAILABLE',
    message: 'Knative runtime is unavailable.',
    mode: MODES.has(runtimeStatus?.mode) ? runtimeStatus.mode : 'disabled',
    state: READINESS.has(runtimeStatus?.state) ? runtimeStatus.state : 'unavailable',
    reason: SAFE_REASON.test(runtimeStatus?.reason ?? '') ? runtimeStatus.reason : 'STATUS_UNAVAILABLE',
    correlationId,
  };
}

export function functionsDisabledResponse(correlationId = randomUUID()) {
  return {
    code: 'FUNCTIONS_DISABLED',
    message: 'Functions capability is disabled.',
    correlationId,
  };
}

export function publicKnativeStatus(status) {
  return {
    mode: status.mode,
    owner: status.owner,
    version: status.version,
    compatibility: status.compatibility,
    state: status.state,
    stage: status.stage,
    reason: status.reason,
    lastTransitionAt: status.lastTransitionAt,
  };
}
