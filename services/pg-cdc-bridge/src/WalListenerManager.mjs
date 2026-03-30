import { PgWalListener } from './PgWalListener.mjs';
import { WalEventDecoder } from './WalEventDecoder.mjs';
import { RouteFilter } from './RouteFilter.mjs';
import { CaptureConfigCache } from './CaptureConfigCache.mjs';
import { KafkaChangePublisher } from './KafkaChangePublisher.mjs';
export class WalListenerManager {
  constructor({ pool, kafka, decoderFactory, routeFilterFactory, publisherFactory, metricsCollector, connectionString = process.env.DATABASE_URL }) {
    this.pool = pool; this.kafka = kafka; this.decoderFactory = decoderFactory; this.routeFilterFactory = routeFilterFactory; this.publisherFactory = publisherFactory; this.metricsCollector = metricsCollector; this.connectionString = connectionString; this._listeners = new Map();
  }
  async _startListener(dataSourceRef) {
    const cache = new CaptureConfigCache({ pool: this.pool });
    const decoder = this.decoderFactory ? this.decoderFactory() : new WalEventDecoder();
    const routeFilter = this.routeFilterFactory ? this.routeFilterFactory(cache) : new RouteFilter(cache);
    const publisher = this.publisherFactory ? this.publisherFactory() : new KafkaChangePublisher({ kafka: this.kafka, metricsCollector: this.metricsCollector });
    if (!publisher.connected) await publisher.initialize?.();
    const listener = new PgWalListener({ connectionString: this.connectionString, dataSourceRef, decoder, routeFilter, publisher });
    await listener.start();
    this._listeners.set(dataSourceRef, { listener, backoffMs: 1000, publisher });
  }
  async start() {
    const { rows } = await this.pool.query(`SELECT DISTINCT data_source_ref FROM pg_capture_configs WHERE status = 'active'`);
    for (const row of rows) await this._startListener(row.data_source_ref);
  }
  _scheduleReconnect(dataSourceRef, backoffMs = 1000) { setTimeout(() => this._startListener(dataSourceRef).catch(() => this._scheduleReconnect(dataSourceRef, Math.min(backoffMs * 2, 60000))), backoffMs); }
  async stop() { await Promise.all([...this._listeners.values()].map(async ({ listener, publisher }) => { await listener.stop(); await publisher.disconnect?.(); })); this._listeners.clear(); }
  health() { return [...this._listeners.entries()].map(([dataSourceRef, { listener }]) => ({ dataSourceRef, isRunning: listener.isRunning })); }
}
