import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../../services/provisioning-orchestrator/src/actions/tenant-config-preflight.mjs';

const defaultAuth = { actor_id: 'sre-1', actor_type: 'sre', scopes: ['platform:admin:config:reprovision'] };
const silentLog = { error: () => {}, warn: () => {}, info: () => {} };

function makeArtifact(tenantId = 'tenant-source', domainOverrides = {}) {
  return {
    tenant_id: tenantId,
    format_version: '1.0.0',
    domains: [
      { domain_key: 'iam', status: 'ok', data: { realm: tenantId, roles: [{ name: 'admin', composites: { realm: ['view'] }, attributes: {} }], groups: [], client_scopes: [], identity_providers: [], ...domainOverrides.iam } },
      { domain_key: 'postgres_metadata', status: 'ok', data: { schema: tenantId.replace(/-/g, '_'), schemas: [], tables: [{ name: 'events', columns: [{ column_name: 'id', data_type: 'uuid' }] }], views: [], extensions: [], grants: [], ...domainOverrides.postgres } },
      { domain_key: 'mongo_metadata', status: 'ok', data: { database: tenantId.replace(/-/g, '_'), collections: [{ name: 'logs', validator: {} }], indexes: [], ...domainOverrides.mongo } },
      { domain_key: 'kafka', status: 'ok', data: { topics: [{ name: `${tenantId}.events`, numPartitions: 3, configEntries: {} }], acls: [], ...domainOverrides.kafka } },
      { domain_key: 'functions', status: 'ok', data: { namespace: tenantId, actions: [{ name: 'hello', exec: { kind: 'nodejs:20', code: 'fn()' }, limits: {}, parameters: [] }], packages: [], triggers: [], rules: [], ...domainOverrides.functions } },
      { domain_key: 'storage', status: 'ok', data: { buckets: [{ name: `${tenantId}-uploads`, versioning: 'Enabled' }], ...domainOverrides.storage } },
    ],
  };
}

function createMockAnalyzerRegistry({ failDomains = [], existingResources = {} } = {}) {
  const map = new Map();

  for (const dk of ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage']) {
    map.set(dk, async (tenantId, domainData) => {
      if (failDomains.includes(dk)) {
        throw new Error(`${dk} subsystem unreachable`);
      }

      const items = _extractItems(dk, domainData);
      let compatible = 0;
      let redacted = 0;
      const conflicts = [];
      const compatibleWithRedacted = [];

      for (const item of items) {
        const key = `${dk}:${item.name}`;
        const existing = existingResources[key];
        if (!existing) {
          compatible++;
        } else if (existing.status === 'same') {
          compatible++;
        } else if (existing.status === 'redacted_only') {
          redacted++;
          compatibleWithRedacted.push({ resource_type: dk, resource_name: item.name, resource_id: null, redacted_fields: ['secret'] });
        } else if (existing.status === 'different') {
          conflicts.push({
            resource_type: existing.resource_type ?? dk,
            resource_name: item.name,
            resource_id: null,
            severity: existing.severity ?? 'medium',
            diff: existing.diff ?? { field: { artifact: 'a', destination: 'b' } },
            recommendation: existing.recommendation ?? `Check ${item.name}`,
          });
        }
      }

      return {
        domain_key: dk,
        status: conflicts.length > 0 ? 'analyzed' : 'no_conflicts',
        resources_analyzed: compatible + redacted + conflicts.length,
        compatible_count: compatible,
        compatible_with_redacted_count: redacted,
        conflicts,
        compatible_with_redacted: compatibleWithRedacted,
        analysis_error_message: null,
      };
    });
  }

  return map;
}

function _extractItems(dk, data) {
  if (!data) return [];
  switch (dk) {
    case 'iam': return [...(data.roles ?? []), ...(data.groups ?? []), ...(data.client_scopes ?? []), ...(data.identity_providers ?? [])];
    case 'postgres_metadata': return [...(data.schemas ?? []), ...(data.tables ?? []), ...(data.views ?? []), ...(data.extensions ?? []), ...(data.grants ?? [])];
    case 'mongo_metadata': return [...(data.collections ?? []), ...(data.indexes ?? [])];
    case 'kafka': return [...(data.topics ?? []), ...(data.acls ?? [])];
    case 'functions': return [...(data.actions ?? []), ...(data.packages ?? []), ...(data.triggers ?? []), ...(data.rules ?? [])];
    case 'storage': return [...(data.buckets ?? [])];
    default: return [];
  }
}

function createOverrides(extra = {}) {
  const spies = { audit: [], publish: [] };
  return {
    overrides: {
      auth: defaultAuth,
      tenantExists: async () => true,
      isSameMajor: (a, b) => String(a).split('.')[0] === String(b).split('.')[0],
      getAnalyzerRegistry: () => createMockAnalyzerRegistry(extra.analyzerOpts ?? {}),
      insertPreflightAuditLog: async (db, r) => { spies.audit.push(r); return { id: 'audit-1' }; },
      publishPreflightAuditEvent: async (producer, p) => { spies.publish.push(p); return { published: false }; },
      db: {},
      log: silentLog,
      ...extra.overrideOverrides,
    },
    spies,
  };
}

// --- E2E 1: Empty tenant, 6 domains, no conflicts ---
test('e2e preflight: empty tenant 6 domains → risk low, audit + kafka', async () => {
  const { overrides, spies } = createOverrides();
  const res = await main({ tenant_id: 'tenant-dest', artifact: makeArtifact('tenant-dest') }, overrides);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.risk_level, 'low');
  assert.equal(res.body.summary.incomplete_analysis, false);
  assert.ok(res.body.domains.length >= 6);
  assert.ok(spies.audit.length > 0, 'audit written');
  assert.ok(spies.publish.length > 0, 'event published');
});

// --- E2E 2: Domain filter ---
test('e2e preflight: domain filter ["iam", "functions"]', async () => {
  const { overrides } = createOverrides();
  const res = await main({ tenant_id: 'tenant-dest', artifact: makeArtifact('tenant-dest'), domains: ['iam', 'functions'] }, overrides);
  assert.equal(res.statusCode, 200);
  const analyzedKeys = res.body.domains.filter(d => d.status !== 'skipped_not_exportable').map(d => d.domain_key);
  assert.ok(analyzedKeys.includes('iam'));
  assert.ok(analyzedKeys.includes('functions'));
  assert.ok(!analyzedKeys.includes('postgres_metadata'));
});

// --- E2E 3: Role with different composites → medium ---
test('e2e preflight: role with different composites → medium', async () => {
  const { overrides } = createOverrides({
    analyzerOpts: { existingResources: { 'iam:admin': { status: 'different', severity: 'medium', resource_type: 'role', recommendation: 'Check permisos' } } },
  });
  const res = await main({ tenant_id: 'tenant-dest', artifact: makeArtifact('tenant-dest') }, overrides);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.risk_level, 'medium');
  assert.equal(res.body.summary.conflict_counts.medium, 1);
});

// --- E2E 4: Table PG incompatible + IAM compatible → risk high ---
test('e2e preflight: table PG high + IAM compatible → risk high', async () => {
  const { overrides } = createOverrides({
    analyzerOpts: { existingResources: { 'postgres_metadata:events': { status: 'different', severity: 'high', resource_type: 'table', recommendation: 'Fix columns' } } },
  });
  const res = await main({ tenant_id: 'tenant-dest', artifact: makeArtifact('tenant-dest') }, overrides);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.risk_level, 'high');
});

// --- E2E 5: MongoDB timeout → incomplete_analysis ---
test('e2e preflight: MongoDB timeout → incomplete_analysis', async () => {
  const { overrides } = createOverrides({
    analyzerOpts: { failDomains: ['mongo_metadata'] },
  });
  const res = await main({ tenant_id: 'tenant-dest', artifact: makeArtifact('tenant-dest') }, overrides);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.incomplete_analysis, true);
  const mongoDomain = res.body.domains.find(d => d.domain_key === 'mongo_metadata');
  assert.equal(mongoDomain.status, 'analysis_error');
  // Other domains should still be analyzed
  const iamDomain = res.body.domains.find(d => d.domain_key === 'iam');
  assert.ok(['analyzed', 'no_conflicts'].includes(iamDomain.status));
});

// --- E2E 6: All analyzers fail ---
test('e2e preflight: all analyzers fail → incomplete_analysis, zero conflicts', async () => {
  const { overrides } = createOverrides({
    analyzerOpts: { failDomains: ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage'] },
  });
  const res = await main({ tenant_id: 'tenant-dest', artifact: makeArtifact('tenant-dest') }, overrides);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.incomplete_analysis, true);
  assert.equal(res.body.summary.risk_level, 'low');
});

// --- E2E 7: Incompatible format_version → 422 ---
test('e2e preflight: incompatible format_version → 422', async () => {
  const { overrides } = createOverrides();
  const artifact = makeArtifact('tenant-dest');
  artifact.format_version = '2.0.0';
  const res = await main({ tenant_id: 'tenant-dest', artifact }, overrides);
  assert.equal(res.statusCode, 422);
});

// --- E2E 8: tenant_id differs without map → needs_confirmation ---
test('e2e preflight: tenant differs without map → needs_confirmation', async () => {
  const { overrides } = createOverrides();
  const res = await main({ tenant_id: 'tenant-dest', artifact: makeArtifact('tenant-source') }, overrides);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.needs_confirmation, true);
  assert.ok(res.body.identifier_map_proposal);
  assert.equal(res.body.domains.length, 0);
});

// --- E2E 9: tenant_id differs with confirmed map → analysis with dest identifiers ---
test('e2e preflight: tenant differs with confirmed map → analysis executed', async () => {
  const { overrides } = createOverrides();
  const identifierMap = { entries: [{ from: 'tenant-source', to: 'tenant-dest', scope: 'tenant_id' }] };
  const res = await main({ tenant_id: 'tenant-dest', artifact: makeArtifact('tenant-source'), identifier_map: identifierMap }, overrides);
  assert.equal(res.statusCode, 200);
  assert.ok(!res.body.needs_confirmation);
  assert.ok(res.body.domains.length > 0);
});

// --- E2E 10: Redacted-only diff → compatible_with_redacted_fields ---
test('e2e preflight: redacted-only diff → compatible_with_redacted_fields', async () => {
  const { overrides } = createOverrides({
    analyzerOpts: { existingResources: { 'functions:hello': { status: 'redacted_only' } } },
  });
  const res = await main({ tenant_id: 'tenant-dest', artifact: makeArtifact('tenant-dest') }, overrides);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.compatible_with_redacted_fields, 1);
  // Should not appear as conflict
  const fnDomain = res.body.domains.find(d => d.domain_key === 'functions');
  assert.equal(fnDomain.conflicts.length, 0);
});

// --- E2E 11: Two simultaneous invocations ---
test('e2e preflight: two simultaneous invocations complete', async () => {
  const { overrides: o1 } = createOverrides();
  const { overrides: o2 } = createOverrides();
  const [r1, r2] = await Promise.all([
    main({ tenant_id: 'tenant-dest', artifact: makeArtifact('tenant-dest') }, o1),
    main({ tenant_id: 'tenant-dest', artifact: makeArtifact('tenant-dest') }, o2),
  ]);
  assert.equal(r1.statusCode, 200);
  assert.equal(r2.statusCode, 200);
});

// --- E2E 12: Kafka publish fails → audit still inserted, 200 returned ---
test('e2e preflight: Kafka fails → audit inserted, 200 returned', async () => {
  const { overrides, spies } = createOverrides({
    overrideOverrides: {
      publishPreflightAuditEvent: async () => { throw new Error('Kafka unreachable'); },
    },
  });
  // Re-set publish to use the override
  overrides.publishPreflightAuditEvent = async () => { throw new Error('Kafka unreachable'); };
  const res = await main({ tenant_id: 'tenant-dest', artifact: makeArtifact('tenant-dest') }, overrides);
  assert.equal(res.statusCode, 200);
  assert.ok(spies.audit.length > 0, 'Audit should still be inserted');
});
