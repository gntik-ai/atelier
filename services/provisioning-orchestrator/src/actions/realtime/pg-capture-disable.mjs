import { CaptureConfigRepository } from '../../repositories/realtime/CaptureConfigRepository.mjs';
import { CaptureAuditRepository } from '../../repositories/realtime/CaptureAuditRepository.mjs';
import { PgCaptureLifecyclePublisher } from '../../events/realtime/PgCaptureLifecyclePublisher.mjs';
const decodeAuth = (header) => { if (!header?.startsWith('Bearer ')) return null; try { return JSON.parse(Buffer.from(header.slice(7), 'base64url').toString('utf8')); } catch { return null; } };
export async function main(params, deps = {}) {
  const claims = decodeAuth(params?.__ow_headers?.authorization);
  if (!claims?.workspace_id || !claims?.tenant_id) return { statusCode: 401, body: { code: 'UNAUTHORIZED' } };
  const repo = deps.configRepo ?? new CaptureConfigRepository(deps.db);
  const auditRepo = deps.auditRepo ?? new CaptureAuditRepository(deps.db);
  const publisher = deps.publisher ?? new PgCaptureLifecyclePublisher(deps.producer);
  const captureId = params.captureId ?? params.path?.captureId;
  const current = await repo.findById(claims.tenant_id, claims.workspace_id, captureId);
  if (!current) return { statusCode: 404, body: { code: 'CAPTURE_NOT_FOUND' } };
  if (current.status === 'disabled') return { statusCode: 409, body: { code: 'CAPTURE_ALREADY_DISABLED' } };
  const actorIdentity = claims.actor_identity ?? claims.sub ?? 'unknown';
  const updated = await repo.disable(captureId, actorIdentity);
  Promise.resolve(auditRepo.append({ captureId, tenantId: claims.tenant_id, workspaceId: claims.workspace_id, actorIdentity, action: 'capture-disabled', beforeState: current.toJSON(), afterState: updated.toJSON(), requestId: params.requestId ?? null })).catch(() => {});
  Promise.resolve(publisher.publish('capture-disabled', { action: 'capture-disabled', capture_id: captureId, table_name: current.table_name, actor_identity: actorIdentity, tenantId: claims.tenant_id, workspaceId: claims.workspace_id, before_state: current.toJSON(), after_state: updated.toJSON() })).catch(() => {});
  return { statusCode: 204 };
}
