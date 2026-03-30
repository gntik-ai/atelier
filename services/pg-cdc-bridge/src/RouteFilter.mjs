export class RouteFilter {
  constructor(captureConfigCache) { this.captureConfigCache = captureConfigCache; }
  async match(decodedEvent, dataSourceRef) {
    const configs = await this.captureConfigCache.getActiveConfigs(dataSourceRef);
    return configs.filter((config) => config.schema_name === decodedEvent.relation.namespace && config.table_name === decodedEvent.relation.relationName && config.status === 'active');
  }
  async matchForWorkspace(decodedEvent, dataSourceRef, workspaceId) {
    const matches = await this.match(decodedEvent, dataSourceRef);
    return matches.filter((config) => config.workspace_id === workspaceId);
  }
}
