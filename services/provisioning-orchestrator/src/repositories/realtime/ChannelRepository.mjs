import { ChannelType } from '../../models/realtime/ChannelType.mjs';

export class ChannelRepository {
  constructor(db) { this.db = db; }

  async findByWorkspace(tenantId, workspaceId, status = 'available') {
    const { rows } = await this.db.query(
      `SELECT * FROM realtime_channels WHERE tenant_id = $1 AND workspace_id = $2 AND ($3::text IS NULL OR status = $3) ORDER BY channel_type, data_source_ref`,
      [tenantId, workspaceId, status]
    );
    return rows.map(ChannelType.fromRow);
  }

  async findById(tenantId, workspaceId, channelId) {
    const { rows } = await this.db.query(
      `SELECT * FROM realtime_channels WHERE tenant_id = $1 AND workspace_id = $2 AND id = $3 LIMIT 1`,
      [tenantId, workspaceId, channelId]
    );
    return rows[0] ? ChannelType.fromRow(rows[0]) : null;
  }

  async findByTypeAndRef(tenantId, workspaceId, channelType, dataSourceRef) {
    const { rows } = await this.db.query(
      `SELECT * FROM realtime_channels WHERE tenant_id = $1 AND workspace_id = $2 AND channel_type = $3 AND data_source_ref = $4 LIMIT 1`,
      [tenantId, workspaceId, channelType, dataSourceRef]
    );
    return rows[0] ? ChannelType.fromRow(rows[0]) : null;
  }
}
