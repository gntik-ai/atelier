import { MongoCaptureConfigRepository } from '../../repositories/realtime/MongoCaptureConfigRepository.mjs';

const decodeAuth = (header) => {
  if (!header?.startsWith('Bearer ')) return null;
  try { return JSON.parse(Buffer.from(header.slice(7), 'base64url').toString('utf8')); } catch { return null; }
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export async function main(params, deps = {}) {
  const claims = decodeAuth(params?.__ow_headers?.authorization);
  if (!claims?.workspace_id || !claims?.tenant_id) return { statusCode: 401, body: { code: 'UNAUTHORIZED' } };

  const repo = deps.configRepo ?? new MongoCaptureConfigRepository(deps.db);
  const items = await repo.findByWorkspace(claims.tenant_id, claims.workspace_id, params?.__ow_query?.status ?? params.status ?? null);
  const page = parsePositiveInt(params?.__ow_query?.page ?? params.page, 1);
  const limit = parsePositiveInt(params?.__ow_query?.limit ?? params.limit, items.length || 50);
  const start = (page - 1) * limit;
  const pagedItems = items.slice(start, start + limit);

  return {
    statusCode: 200,
    body: {
      items: pagedItems.map((item) => item.toJSON()),
      total: items.length,
      page,
      limit
    }
  };
}
