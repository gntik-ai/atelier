import { createScopeEnforcementDenial, validateScopeEnforcementDenial } from '../models/scope-enforcement-denial.mjs';
import { insertDenial } from '../repositories/scope-enforcement-repo.mjs';

export function buildScopeEnforcementRecorderDependencies(overrides = {}) {
  return {
    db: overrides.db,
    log: overrides.log ?? console,
    insertDenial: overrides.insertDenial ?? insertDenial,
    createScopeEnforcementDenial: overrides.createScopeEnforcementDenial ?? createScopeEnforcementDenial,
    validateScopeEnforcementDenial: overrides.validateScopeEnforcementDenial ?? validateScopeEnforcementDenial
  };
}

function normalizeMessage(message) {
  const payload = typeof message.value === 'string' ? JSON.parse(message.value) : message.value ?? message;
  return {
    tenantId: payload.tenant_id,
    workspaceId: payload.workspace_id ?? null,
    actorId: payload.actor_id,
    actorType: payload.actor_type,
    denialType: payload.denial_type ?? payload.event_type,
    httpMethod: payload.http_method,
    requestPath: payload.request_path,
    requiredScopes: payload.required_scopes ?? [],
    presentedScopes: payload.presented_scopes ?? [],
    missingScopes: payload.missing_scopes ?? [],
    requiredEntitlement: payload.required_entitlement ?? null,
    currentPlanId: payload.current_plan_id ?? null,
    sourceIp: payload.source_ip ?? null,
    correlationId: payload.correlation_id,
    deniedAt: payload.denied_at
  };
}

export async function main(params = {}, overrides = {}) {
  const dependencies = buildScopeEnforcementRecorderDependencies(overrides);
  const messages = params.messages ?? params.records ?? [];
  let inserted = 0;
  let skipped = 0;
  for (const message of messages) {
    try {
      const normalized = normalizeMessage(message);
      dependencies.validateScopeEnforcementDenial(normalized);
      const record = dependencies.createScopeEnforcementDenial(normalized);
      await dependencies.insertDenial(dependencies.db, record);
      inserted += 1;
    } catch (error) {
      skipped += 1;
      dependencies.log.warn?.({ event: 'scope_enforcement_denial_skipped', error: error.message });
    }
  }
  return { statusCode: 200, body: { inserted, skipped, commitOffsets: inserted } };
}
