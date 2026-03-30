import { CaptureConfigRepository } from '../../repositories/realtime/CaptureConfigRepository.mjs';
const decodeAuth = (header) => { if (!header?.startsWith('Bearer ')) return null; try { return JSON.parse(Buffer.from(header.slice(7), 'base64url').toString('utf8')); } catch { return null; } };
export async function main(params, deps = {}) {
  const claims = decodeAuth(params?.__ow_headers?.authorization);
  if (!claims?.workspace_id || !claims?.tenant_id) return { statusCode: 401, body: { code: 'UNAUTHORIZED' } };
  const repo = deps.configRepo ?? new CaptureConfigRepository(deps.db);
  const items = await repo.findByWorkspace(claims.tenant_id, claims.workspace_id, params?.__ow_query?.status ?? params.status ?? null);
  return { statusCode: 200, body: { items: items.map((item) => item.toJSON()), total: items.length } };
}
