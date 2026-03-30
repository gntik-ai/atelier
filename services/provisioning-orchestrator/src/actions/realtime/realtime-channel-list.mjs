import { ChannelRepository } from '../../repositories/realtime/ChannelRepository.mjs';

export async function listRealtimeChannels(params, { db } = {}) {
  const tenantId = params.tenantId;
  const workspaceId = params.workspaceId;
  const repository = new ChannelRepository(db);
  const items = await repository.findByWorkspace(tenantId, workspaceId, 'available');
  return { statusCode: 200, body: { items: items.map((item) => item.toJSON()), total: items.length } };
}

export default async function main(params, deps = {}) {
  return listRealtimeChannels(params, deps);
}
