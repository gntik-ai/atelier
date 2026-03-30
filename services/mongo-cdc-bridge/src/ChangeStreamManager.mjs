import { ChangeStreamWatcher } from './ChangeStreamWatcher.mjs';

export class ChangeStreamManager {
  constructor({ pool, mongoClientFactory, configCache, resumeTokenStore, kafkaPublisher, statusUpdater = async () => {}, auditCallback = async () => {} }) {
    this.pool = pool;
    this.mongoClientFactory = mongoClientFactory;
    this.configCache = configCache;
    this.resumeTokenStore = resumeTokenStore;
    this.kafkaPublisher = kafkaPublisher;
    this.statusUpdater = statusUpdater;
    this.auditCallback = auditCallback;
    this.watchers = new Map();
    this.mongoClients = new Map();
  }

  async _mongoClientFor(config) {
    if (!this.mongoClients.has(config.data_source_ref)) this.mongoClients.set(config.data_source_ref, await this.mongoClientFactory(config));
    return this.mongoClients.get(config.data_source_ref);
  }

  async _startWatcher(config) {
    if (this.watchers.has(config.id)) return;
    const mongoClient = await this._mongoClientFor(config);
    const watcher = new ChangeStreamWatcher({
      captureConfig: config,
      mongoClient,
      kafkaPublisher: this.kafkaPublisher,
      resumeTokenStore: this.resumeTokenStore,
      auditCallback: this.auditCallback,
      statusUpdateCallback: async (status, lastError) => this.statusUpdater(config.id, status, lastError)
    });
    this.watchers.set(config.id, watcher);
    watcher.start().catch(() => {});
  }

  async start() {
    const configs = await this.configCache.load(true);
    for (const config of configs) await this._startWatcher(config);
    this.configCache.on('added', (config) => { this._startWatcher(config).catch(() => {}); });
    this.configCache.on('removed', (config) => { this.watchers.get(config.id)?.stop?.(); this.watchers.delete(config.id); });
    this.configCache.startPolling();
  }

  getActiveWatchers() { return [...this.watchers.values()]; }

  async shutdown() {
    this.configCache.stopPolling();
    await Promise.all([...this.watchers.values()].map((watcher) => watcher.stop()));
    await this.kafkaPublisher.disconnect();
    await Promise.all([...this.mongoClients.values()].map((client) => client.close?.() ?? Promise.resolve()));
  }
}
