/**
 * OpenWhisk functions configuration collector.
 * Extracts actions, packages, triggers, and rules for a tenant namespace.
 * @module collectors/functions-collector
 */

import { redactSensitiveFields } from './types.mjs';
import { buildServiceUrl, encodePathSegment, normalizeServiceBaseUrl } from '../http/safe-url.mjs';

const DOMAIN_KEY = 'functions';

/**
 * @param {string} tenantId
 * @param {Object} [options]
 * @param {typeof globalThis.fetch} [options.fetchFn]
 * @returns {Promise<import('./types.mjs').CollectorResult>}
 */
export async function collect(tenantId, options = {}) {
  const exportedAt = new Date().toISOString();
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  if (process.env.CONFIG_EXPORT_OW_ENABLED !== 'true') {
    return { domain_key: DOMAIN_KEY, status: 'not_available', exported_at: exportedAt, reason: 'OpenWhisk collector disabled (CONFIG_EXPORT_OW_ENABLED != true)', data: null };
  }

  const apiHost = process.env.CONFIG_EXPORT_OW_API_HOST;
  const authToken = process.env.CONFIG_EXPORT_OW_AUTH_TOKEN;

  if (!apiHost || !authToken) {
    return { domain_key: DOMAIN_KEY, status: 'not_available', exported_at: exportedAt, reason: 'OpenWhisk credentials not configured', data: null };
  }

  const headers = {
    Authorization: `Basic ${Buffer.from(authToken).toString('base64')}`,
    Accept: 'application/json',
  };
  const normalizedApiHost = normalizeServiceBaseUrl(apiHost, 'CONFIG_EXPORT_OW_API_HOST', {
    allowBareInternalHttp: true,
  });
  const ns = encodePathSegment(tenantId, 'tenantId');
  const base = buildServiceUrl(normalizedApiHost, `api/v1/namespaces/${ns}`);

  try {
    const [actionsRes, packagesRes, triggersRes, rulesRes] = await Promise.all([
      fetchFn(buildServiceUrl(base, 'actions'), { headers }).then(r => r.ok ? r.json() : []),
      fetchFn(buildServiceUrl(base, 'packages'), { headers }).then(r => r.ok ? r.json() : []),
      fetchFn(buildServiceUrl(base, 'triggers'), { headers }).then(r => r.ok ? r.json() : []),
      fetchFn(buildServiceUrl(base, 'rules'), { headers }).then(r => r.ok ? r.json() : []),
    ]);

    // Enrich actions with full definitions (code, limits, params)
    const actions = await Promise.all((actionsRes ?? []).map(async (action) => {
      try {
        const fullRes = await fetchFn(buildServiceUrl(base, `actions/${encodeURIComponent(action.name)}`), { headers });
        if (!fullRes.ok) return { ...action, code_base64: null, code_available: false };
        const full = await fullRes.json();

        let codeBase64 = null;
        let codeAvailable = false;
        if (full.exec?.code && typeof full.exec.code === 'string') {
          codeBase64 = Buffer.from(full.exec.code).toString('base64');
          codeAvailable = true;
        }

        // Redact parameters with encrypt: true or sensitive key patterns
        const params = (full.parameters ?? []).map(p => {
          if (p.encrypt === true || /(?:secret|password|token|key|credential)/i.test(p.key ?? '')) {
            return { ...p, value: '***REDACTED***' };
          }
          return p;
        });

        return {
          name: full.name,
          namespace: full.namespace,
          kind: full.exec?.kind,
          limits: full.limits,
          parameters: params,
          annotations: full.annotations,
          code_base64: codeBase64,
          code_available: codeAvailable,
        };
      } catch {
        return { ...action, code_base64: null, code_available: false };
      }
    }));

    const packages = packagesRes ?? [];
    const triggers = triggersRes ?? [];
    const rules = rulesRes ?? [];

    if (actions.length === 0 && packages.length === 0) {
      return { domain_key: DOMAIN_KEY, status: 'empty', exported_at: exportedAt, items_count: 0, data: { namespace: tenantId, actions: [], packages: [], triggers: [], rules: [] } };
    }

    const data = redactSensitiveFields({
      namespace: tenantId,
      actions,
      packages,
      triggers,
      rules,
    });

    return {
      domain_key: DOMAIN_KEY,
      status: 'ok',
      exported_at: exportedAt,
      items_count: actions.length + packages.length + triggers.length + rules.length,
      data,
    };
  } catch (err) {
    return { domain_key: DOMAIN_KEY, status: 'error', exported_at: exportedAt, error: err.message, data: null };
  }
}
