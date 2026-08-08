// Fresh-install seed for C-08 platform-governance projections.
//
// DDL is authoritative in migration 123 and is applied by governance-schema.mjs.
// This module projects the canonical domain-model catalogs into those durable tables so
// a fresh install exposes the shipped plans/profiles/quotas/provider capabilities through
// the real GET handlers.  Canonical rows are updatable across releases; operator-created
// rows are never overwritten.
import { readFileSync } from 'node:fs';

const DOMAIN_MODEL_CANDIDATES = Object.freeze([
  '/repo/packages/internal-contracts/src/domain-model.json',
  new URL('../../packages/internal-contracts/src/domain-model.json', import.meta.url)
]);

function readDomainModel() {
  let lastError = null;
  for (const candidate of DOMAIN_MODEL_CANDIDATES) {
    try { return JSON.parse(readFileSync(candidate, 'utf8')); }
    catch (error) { lastError = error; }
  }
  throw Object.assign(new Error('canonical domain model is unavailable'), {
    code: 'C08_DOMAIN_MODEL_UNAVAILABLE', cause: lastError
  });
}

function lifecycle(now) {
  return { createdAt: now, updatedAt: now, activatedAt: now };
}

export function canonicalC08Entities(domainModel, now = new Date().toISOString()) {
  const catalogs = domainModel?.governance_catalogs ?? {};
  const metadata = { managedBy: 'falcone-canonical', catalogVersion: String(domainModel?.version ?? 'unknown') };
  const plans = Array.isArray(catalogs.plans) ? catalogs.plans : [];
  const parentByQuota = new Map(plans.map((plan) => [plan.quotaPolicyId, plan.planId]));
  const rows = [];

  for (const item of catalogs.provider_capabilities ?? []) {
    rows.push({
      entityType: 'provider_capability', entityId: item.providerCapabilityId,
      parentId: null, slug: `${item.provider}:${item.capabilityKey}`, state: 'active',
      projection: {
        entityType: 'provider_capability', providerCapabilityId: item.providerCapabilityId,
        provider: item.provider, capabilityKey: item.capabilityKey, plane: item.plane,
        capabilityStatus: item.capabilityStatus, supportLevel: item.supportLevel,
        allowedEnvironments: item.allowedEnvironments ?? [], state: 'active',
        timestamps: lifecycle(now), metadata
      }
    });
  }
  for (const item of catalogs.deployment_profiles ?? []) {
    rows.push({
      entityType: 'deployment_profile', entityId: item.deploymentProfileId,
      parentId: null, slug: item.slug, state: 'active',
      projection: {
        entityType: 'deployment_profile', deploymentProfileId: item.deploymentProfileId,
        slug: item.slug, displayName: item.displayName, profileClass: item.profileClass,
        supportedEnvironments: item.supportedEnvironments ?? [], planeBindings: item.planeBindings ?? {},
        providerCapabilityIds: item.providerCapabilityIds ?? [], state: 'active',
        timestamps: lifecycle(now), metadata
      }
    });
  }
  for (const item of catalogs.quota_policies ?? []) {
    rows.push({
      entityType: 'quota_policy', entityId: item.quotaPolicyId,
      parentId: parentByQuota.get(item.quotaPolicyId) ?? null, slug: item.slug, state: 'active',
      projection: {
        entityType: 'quota_policy', quotaPolicyId: item.quotaPolicyId,
        slug: item.slug, displayName: item.displayName, quotaScope: item.quotaScope,
        enforcementMode: item.enforcementMode, warningThresholdPercent: item.warningThresholdPercent,
        defaultLimits: item.defaultLimits ?? [], state: 'active', timestamps: lifecycle(now), metadata
      }
    });
  }
  for (const item of plans) {
    rows.push({
      entityType: 'plan', entityId: item.planId, parentId: null, slug: item.slug, state: 'active',
      projection: {
        entityType: 'plan', planId: item.planId, slug: item.slug, displayName: item.displayName,
        planFamily: item.planFamily, planStatus: item.planStatus,
        deploymentProfileId: item.deploymentProfileId, quotaPolicyId: item.quotaPolicyId,
        billingInterval: item.billingInterval, capabilityKeys: item.capabilityKeys ?? [],
        state: 'active', timestamps: lifecycle(now), metadata
      }
    });
  }
  return rows;
}

export async function seedC08CanonicalEntities(pool, {
  domainModel = readDomainModel(),
  now = new Date().toISOString(),
  log = console
} = {}) {
  const rows = canonicalC08Entities(domainModel, now);
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  const release = client !== pool;
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      await client.query(
        `INSERT INTO platform_governance_entities
           (entity_type, entity_id, parent_id, slug, state, projection, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$7)
         ON CONFLICT (entity_type, entity_id) DO UPDATE SET
           parent_id = EXCLUDED.parent_id,
           slug = EXCLUDED.slug,
           state = EXCLUDED.state,
           projection = EXCLUDED.projection,
           updated_at = EXCLUDED.updated_at
         WHERE platform_governance_entities.projection->'metadata'->>'managedBy' = 'falcone-canonical'`,
        [row.entityType, row.entityId, row.parentId, row.slug, row.state, JSON.stringify(row.projection), now]
      );
    }
    await client.query('COMMIT');
    log.log?.(`[control-plane] C-08 canonical governance catalog ready (${rows.length} entities)`);
    return rows.length;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* keep original */ }
    throw error;
  } finally {
    if (release) client.release?.();
  }
}
