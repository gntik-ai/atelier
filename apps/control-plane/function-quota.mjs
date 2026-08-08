// Tenant-level Function action quota gate used by the real Knative deploy path.
// Uses the same override -> plan -> default governance model as workspace quota,
// but evaluates the canonical `max_functions` dimension against durable
// `fn_actions` usage. Resolution failure is explicit: a governed Function deploy
// must not proceed without producing a trustworthy quota-enforcement record.
const QUOTA_REPO = '/repo/packages/provisioning-orchestrator/src/repositories/quota-enforcement-repository.mjs';
const QUOTA_MODEL = '/repo/packages/provisioning-orchestrator/src/models/quota-enforcement.mjs';
export const FUNCTION_QUOTA_DIMENSION = 'max_functions';

async function defaultLoad() {
  const [repo, model] = await Promise.all([
    import(QUOTA_REPO).catch(() => import('../../packages/provisioning-orchestrator/src/repositories/quota-enforcement-repository.mjs')),
    import(QUOTA_MODEL).catch(() => import('../../packages/provisioning-orchestrator/src/models/quota-enforcement.mjs'))
  ]);
  return { resolveEffectiveLimit: repo.resolveEffectiveLimit, evaluateQuotaDecision: model.evaluateQuotaDecision };
}

export async function checkFunctionQuota(pool, tenantId, currentUsage, { load = defaultLoad } = {}) {
  let modules;
  try { modules = await load(); }
  catch (cause) {
    throw Object.assign(new Error('function quota governance modules are unavailable'), {
      statusCode: 503, code: 'FUNCTION_QUOTA_UNAVAILABLE', cause
    });
  }
  try {
    const effective = await modules.resolveEffectiveLimit(pool, tenantId, FUNCTION_QUOTA_DIMENSION);
    const decision = modules.evaluateQuotaDecision({
      effectiveLimit: effective.effectiveLimit,
      quotaType: effective.quotaType,
      graceMargin: effective.graceMargin,
      currentUsage
    });
    return { ...decision, source: effective.source ?? 'default', dimensionKey: FUNCTION_QUOTA_DIMENSION };
  } catch (cause) {
    throw Object.assign(new Error('function quota could not be resolved'), {
      statusCode: 503, code: 'FUNCTION_QUOTA_UNAVAILABLE', cause
    });
  }
}
