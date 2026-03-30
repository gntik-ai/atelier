import { CaptureConfigRepository } from '../../repositories/realtime/CaptureConfigRepository.mjs';
import { CaptureQuotaRepository } from '../../repositories/realtime/CaptureQuotaRepository.mjs';
import { CaptureAuditRepository } from '../../repositories/realtime/CaptureAuditRepository.mjs';
import { PgCaptureLifecyclePublisher } from '../../events/realtime/PgCaptureLifecyclePublisher.mjs';

const unauthorized = () => ({ statusCode: 401, body: { code: 'UNAUTHORIZED' } });
const bodyOf = (params) => params.body ?? params;
const decodeAuth = (header) => {
  if (!header?.startsWith('Bearer ')) return null;
  try { return JSON.parse(Buffer.from(header.slice(7), 'base64url').toString('utf8')); } catch { return null; }
};

export async function main(params, deps = {}) {
  const claims = decodeAuth(params?.__ow_headers?.authorization);
  if (!claims?.workspace_id || !claims?.tenant_id) return unauthorized();
  const body = bodyOf(params);
  if (!body.data_source_ref || !body.table_name) return { statusCode: 400, body: { code: 'INVALID_REQUEST' } };
  const workspaceId = claims.workspace_id;
  const tenantId = claims.tenant_id;
  const actorIdentity = claims.actor_identity ?? claims.sub ?? 'unknown';
  const quotaRepo = deps.quotaRepo ?? new CaptureQuotaRepository(deps.db);
  const configRepo = deps.configRepo ?? new CaptureConfigRepository(deps.db);
  const auditRepo = deps.auditRepo ?? new CaptureAuditRepository(deps.db);
  const publisher = deps.publisher ?? new PgCaptureLifecyclePublisher(deps.producer);
  const workspaceQuota = (await quotaRepo.getQuota('workspace', workspaceId))?.max_tables ?? Number(process.env.PG_CAPTURE_DEFAULT_WORKSPACE_QUOTA ?? 10);
  const workspaceCount = await quotaRepo.countActive('workspace', workspaceId);
  if (workspaceCount >= workspaceQuota) return { statusCode: 429, body: { code: 'QUOTA_EXCEEDED', scope: 'workspace' } };
  const tenantQuota = (await quotaRepo.getQuota('tenant', tenantId))?.max_tables ?? Number(process.env.PG_CAPTURE_DEFAULT_TENANT_QUOTA ?? 50);
  const tenantCount = await quotaRepo.countActive('tenant', tenantId);
  if (tenantCount >= tenantQuota) return { statusCode: 429, body: { code: 'QUOTA_EXCEEDED', scope: 'tenant' } };
  try {
    const created = await configRepo.create({ tenant_id: tenantId, workspace_id: workspaceId, data_source_ref: body.data_source_ref, schema_name: body.schema_name ?? 'public', table_name: body.table_name, actor_identity: actorIdentity });
    Promise.resolve(auditRepo.append({ captureId: created.id, tenantId, workspaceId, actorIdentity, action: 'capture-enabled', beforeState: null, afterState: created.toJSON(), requestId: params.requestId ?? null })).catch(() => {});
    Promise.resolve(publisher.publish('capture-enabled', { action: 'capture-enabled', capture_id: created.id, table_name: created.table_name, actor_identity: actorIdentity, tenantId, workspaceId, before_state: null, after_state: created.toJSON() })).catch(() => {});
    return { statusCode: 201, body: created.toJSON() };
  } catch (error) {
    if (error?.code === 'CAPTURE_ALREADY_ACTIVE') return { statusCode: 409, body: { code: 'CAPTURE_ALREADY_ACTIVE' } };
    if (error?.code === 'QUOTA_EXCEEDED') return { statusCode: 429, body: { code: 'QUOTA_EXCEEDED', scope: error.scope } };
    throw error;
  }
}
