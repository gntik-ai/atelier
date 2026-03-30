import { CaptureConfigRepository } from '../../repositories/realtime/CaptureConfigRepository.mjs';
import { CaptureQuotaRepository } from '../../repositories/realtime/CaptureQuotaRepository.mjs';
const decodeAuth = (header) => { if (!header?.startsWith('Bearer ')) return null; try { return JSON.parse(Buffer.from(header.slice(7), 'base64url').toString('utf8')); } catch { return null; } };
export async function main(params, deps = {}) {
  const claims = decodeAuth(params?.__ow_headers?.authorization);
  const tenantId = params.tenantId ?? params.path?.tenantId;
  if (!claims?.tenant_id || claims.tenant_id !== tenantId || !claims.roles?.includes('tenant_owner')) return { statusCode: 401, body: { code: 'UNAUTHORIZED' } };
  const repo = deps.configRepo ?? new CaptureConfigRepository(deps.db);
  const quotaRepo = deps.quotaRepo ?? new CaptureQuotaRepository(deps.db);
  const workspaces = await repo.findByTenantSummary(tenantId);
  const quotaMax = (await quotaRepo.getQuota('tenant', tenantId))?.max_tables ?? Number(process.env.PG_CAPTURE_DEFAULT_TENANT_QUOTA ?? 50);
  return { statusCode: 200, body: { tenant_id: tenantId, workspaces: workspaces.map((row) => ({ ...row, quota_max: quotaMax })) } };
}
