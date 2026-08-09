import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE_CONTRACT_PATH = fileURLToPath(new URL(
  '../../packages/internal-contracts/src/observability-health-checks.json',
  import.meta.url
));
const IMAGE_CONTRACT_PATH = '/repo/packages/internal-contracts/src/observability-health-checks.json';

function resolveContractPath(explicitPath = process.env.OBSERVABILITY_HEALTH_CONTRACT_FILE) {
  const candidates = [explicitPath, SOURCE_CONTRACT_PATH, IMAGE_CONTRACT_PATH].filter(Boolean);
  const contractPath = candidates.find((candidate) => existsSync(candidate));
  if (!contractPath) {
    throw new Error('Observability health contract is unavailable');
  }
  return contractPath;
}

export function readHealthContract(contractPath) {
  return JSON.parse(readFileSync(resolveContractPath(contractPath), 'utf8'));
}

const DEFAULT_CONTRACT = readHealthContract();

export function assertHealthContract(contract = DEFAULT_CONTRACT) {
  const mapping = contract?.control_plane_probe_mapping;
  const expectedRoutes = {
    liveness: '/livez',
    readiness: '/readyz',
    compatibility_health: '/healthz'
  };
  const probeTypes = new Set((contract?.probe_types ?? []).map(({ id }) => id));
  const componentIds = (contract?.components ?? []).map(({ id }) => id);
  const violations = [];

  for (const probeType of ['liveness', 'readiness', 'health']) {
    if (!probeTypes.has(probeType)) violations.push(`missing probe type ${probeType}`);
  }
  if (componentIds.length === 0 || new Set(componentIds).size !== componentIds.length) {
    violations.push('component catalog must be non-empty and unique');
  }
  for (const [probeId, expectedPath] of Object.entries(expectedRoutes)) {
    if (mapping?.probe_routes?.[probeId]?.path !== expectedPath) {
      violations.push(`${probeId} must map to ${expectedPath}`);
    }
  }
  for (const exposureKind of ['aggregate', 'component']) {
    for (const probeType of ['liveness', 'readiness', 'health']) {
      if (
        mapping?.internal_exposures?.[exposureKind]?.[probeType]
        !== contract?.exposure_templates?.[exposureKind]?.[probeType]?.path
      ) {
        violations.push(`${exposureKind} ${probeType} exposure mapping is stale`);
      }
    }
  }
  const expectedPrecedence = {
    liveness: ['dead', 'unknown', 'live'],
    readiness: ['not_ready', 'degraded', 'unknown', 'ready'],
    health: ['unavailable', 'degraded', 'stale', 'unknown', 'inherited', 'healthy']
  };
  for (const [probeType, expected] of Object.entries(expectedPrecedence)) {
    if (
      JSON.stringify(contract?.status_model?.aggregate_precedence?.[probeType])
      !== JSON.stringify(expected)
    ) {
      violations.push(`${probeType} aggregate precedence is invalid`);
    }
  }
  if (
    mapping?.public_edge?.gateway_registered !== false
    || mapping?.public_edge?.spa_proxy_registered !== false
  ) {
    violations.push('internal probes must remain outside the public edge');
  }
  if (violations.length > 0) {
    throw new Error(`Invalid observability health contract: ${violations.join('; ')}`);
  }
  return contract;
}

assertHealthContract(DEFAULT_CONTRACT);

export const HEALTH_COMPONENT_IDS = Object.freeze(
  DEFAULT_CONTRACT.components.map((component) => component.id)
);
export const HEALTH_PROBE_TYPES = Object.freeze(
  DEFAULT_CONTRACT.probe_types.map((probeType) => probeType.id)
);

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const DEFAULT_PROBE_TIMEOUT_MS = 1_000;

function isoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('health clock must return a valid date');
  return date.toISOString();
}

export function createHealthCorrelationId(input, factory = randomUUID) {
  return typeof input === 'string' && CORRELATION_ID_PATTERN.test(input)
    ? input
    : factory();
}

function allowedStatuses(contract) {
  return Object.fromEntries(
    contract.probe_types.map((probeType) => [probeType.id, new Set(probeType.allowed_statuses)])
  );
}

function missingAdapterOutcome() {
  return { status: 'unknown', summary: 'No runtime probe evidence is available' };
}

function controlPlaneAdapter(schemaReadiness) {
  return async ({ probeType }) => {
    if (probeType === 'liveness') {
      return { status: 'live', summary: 'Control-plane process is serving requests' };
    }

    const schemaUnavailable = schemaReadiness?.responseForReadyProbe?.() ?? null;
    if (schemaUnavailable) {
      return probeType === 'readiness'
        ? { status: 'not_ready', summary: 'Control-plane schema is not ready' }
        : { status: 'degraded', summary: 'Control-plane dependencies are not ready' };
    }

    return probeType === 'readiness'
      ? { status: 'ready', summary: 'Control-plane runtime is ready' }
      : { status: 'healthy', summary: 'Control-plane runtime is healthy' };
  };
}

function postgresqlAdapter(pool) {
  return async ({ probeType }) => {
    try {
      await pool.query('SELECT 1');
      if (probeType === 'liveness') {
        return { status: 'live', summary: 'PostgreSQL responded to a bounded probe' };
      }
      return probeType === 'readiness'
        ? { status: 'ready', summary: 'PostgreSQL is ready' }
        : { status: 'healthy', summary: 'PostgreSQL is healthy' };
    } catch {
      if (probeType === 'liveness') {
        return { status: 'unknown', summary: 'PostgreSQL liveness could not be established' };
      }
      return probeType === 'readiness'
        ? { status: 'not_ready', summary: 'PostgreSQL is not ready' }
        : { status: 'unavailable', summary: 'PostgreSQL is unavailable' };
    }
  };
}

async function runBounded(adapter, context, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error('probe timeout'), { code: 'PROBE_TIMEOUT' }));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => adapter({ ...context, signal: controller.signal })),
      timeout
    ]);
  } catch (error) {
    return {
      status: 'unknown',
      summary: error?.code === 'PROBE_TIMEOUT'
        ? 'Probe timed out before evidence was available'
        : 'Probe failed without safe evidence'
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeOutcome(outcome, probeType, statuses) {
  const candidate = outcome && typeof outcome === 'object' ? outcome : missingAdapterOutcome();
  if (!statuses[probeType]?.has(candidate.status)) return missingAdapterOutcome();

  // Adapter exceptions and provider payloads are never copied into an operational response.
  // Only the runtime-owned, bounded summary vocabulary is accepted.
  const safeSummaries = new Set([
    'Control-plane process is serving requests',
    'Control-plane schema is not ready',
    'Control-plane dependencies are not ready',
    'Control-plane runtime is ready',
    'Control-plane runtime is healthy',
    'PostgreSQL responded to a bounded probe',
    'PostgreSQL is ready',
    'PostgreSQL is healthy',
    'PostgreSQL liveness could not be established',
    'PostgreSQL is not ready',
    'PostgreSQL is unavailable',
    'Probe timed out before evidence was available',
    'Probe failed without safe evidence',
    'No runtime probe evidence is available'
  ]);

  return {
    status: candidate.status,
    summary: safeSummaries.has(candidate.summary)
      ? candidate.summary
      : `Probe reported ${candidate.status}`
  };
}

export function buildComponentProbeResult({
  componentId,
  probeType,
  outcome,
  correlationId,
  observedAt,
  evidenceFreshnessSeconds = 0
}) {
  return {
    component_id: componentId,
    probe_type: probeType,
    status: outcome.status,
    observed_at: observedAt,
    summary: outcome.summary,
    correlation_id: correlationId,
    evidence_freshness_seconds: evidenceFreshnessSeconds
  };
}

export function aggregateProbeResults(
  componentResults,
  probeType,
  correlationId,
  observedAt,
  contract = DEFAULT_CONTRACT
) {
  const statuses = new Set(componentResults.map((result) => result.status));
  const precedence = contract.status_model.aggregate_precedence[probeType];
  const status = precedence.find((candidate) => statuses.has(candidate))
    ?? precedence.at(-1);

  return {
    probe_type: probeType,
    status,
    observed_at: observedAt,
    component_results: componentResults,
    correlation_id: correlationId
  };
}

export function validateComponentProbeResult(result, contract = DEFAULT_CONTRACT) {
  const required = contract.response_contracts.component_probe_result.required_fields;
  // The current runtime projection intentionally emits only the closed required-field shape.
  // Optional contract sections need their own typed validators before this boundary can emit them.
  const allowedFields = new Set(required);
  const statuses = allowedStatuses(contract);
  return required.every((field) => Object.hasOwn(result, field))
    && Object.keys(result).every((field) => allowedFields.has(field))
    && contract.components.some((component) => component.id === result.component_id)
    && statuses[result.probe_type]?.has(result.status) === true
    && !Number.isNaN(Date.parse(result.observed_at))
    && typeof result.summary === 'string'
    && typeof result.correlation_id === 'string'
    && CORRELATION_ID_PATTERN.test(result.correlation_id)
    && Number.isFinite(result.evidence_freshness_seconds)
    && result.evidence_freshness_seconds >= 0;
}

export function validatePlatformProbeRollup(result, contract = DEFAULT_CONTRACT) {
  const required = contract.response_contracts.platform_probe_rollup.required_fields;
  const allowedFields = new Set(required);
  const statuses = allowedStatuses(contract);
  const canonicalComponentIds = contract.components.map((component) => component.id);
  const resultComponentIds = Array.isArray(result.component_results)
    ? result.component_results.map((component) => component.component_id)
    : [];
  return required.every((field) => Object.hasOwn(result, field))
    && Object.keys(result).every((field) => allowedFields.has(field))
    && statuses[result.probe_type]?.has(result.status) === true
    && !Number.isNaN(Date.parse(result.observed_at))
    && typeof result.correlation_id === 'string'
    && CORRELATION_ID_PATTERN.test(result.correlation_id)
    && Array.isArray(result.component_results)
    && result.component_results.length === contract.components.length
    && new Set(resultComponentIds).size === canonicalComponentIds.length
    && canonicalComponentIds.every((componentId) => resultComponentIds.includes(componentId))
    && result.component_results.every((component) => (
      validateComponentProbeResult(component, contract)
      && component.probe_type === result.probe_type
      && component.correlation_id === result.correlation_id
    ))
    && aggregateProbeResults(
      result.component_results,
      result.probe_type,
      result.correlation_id,
      result.observed_at,
      contract
    ).status === result.status;
}

export function createHealthRuntime({
  pool,
  schemaReadiness,
  componentAdapters = {},
  contract = DEFAULT_CONTRACT,
  clock = () => new Date(),
  correlationIdFactory = randomUUID,
  probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS
} = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('health runtime requires pool.query()');
  if (!Number.isFinite(probeTimeoutMs) || probeTimeoutMs <= 0) {
    throw new TypeError('health probe timeout must be a positive finite number');
  }

  const componentIds = Object.freeze(contract.components.map((component) => component.id));
  const probeTypes = new Set(contract.probe_types.map((probeType) => probeType.id));
  const statuses = allowedStatuses(contract);
  const adapters = {
    control_plane: controlPlaneAdapter(schemaReadiness),
    postgresql: postgresqlAdapter(pool),
    ...componentAdapters
  };

  async function evaluateComponent(probeType, componentId, correlationId, observedAt) {
    const adapter = adapters[componentId];
    const rawOutcome = adapter
      ? await runBounded(adapter, { componentId, probeType }, probeTimeoutMs)
      : missingAdapterOutcome();
    const outcome = normalizeOutcome(rawOutcome, probeType, statuses);
    const result = buildComponentProbeResult({
      componentId,
      probeType,
      outcome,
      correlationId,
      observedAt
    });

    if (!validateComponentProbeResult(result, contract)) {
      throw new Error('Health component response failed contract validation');
    }
    return result;
  }

  return Object.freeze({
    componentIds,

    createCorrelationId(input) {
      return createHealthCorrelationId(input, correlationIdFactory);
    },

    async evaluate(probeType, { componentId, correlationId } = {}) {
      if (!probeTypes.has(probeType)) throw new TypeError('Unknown health probe type');
      if (componentId && !componentIds.includes(componentId)) return null;

      const boundedCorrelationId = createHealthCorrelationId(correlationId, correlationIdFactory);
      const observedAt = isoTimestamp(clock());
      if (componentId) {
        return evaluateComponent(probeType, componentId, boundedCorrelationId, observedAt);
      }

      const componentResults = await Promise.all(componentIds.map((id) => (
        evaluateComponent(probeType, id, boundedCorrelationId, observedAt)
      )));
      const rollup = aggregateProbeResults(
        componentResults,
        probeType,
        boundedCorrelationId,
        observedAt,
        contract
      );
      if (!validatePlatformProbeRollup(rollup, contract)) {
        throw new Error('Health rollup response failed contract validation');
      }
      return rollup;
    }
  });
}
