import { EventEmitter } from 'node:events';

export class MongoCaptureConfigCache extends EventEmitter {
  constructor({ pool, ttlSeconds = Number(process.env.MONGO_CDC_CACHE_TTL_SECONDS ?? 30) }) {
    super();
    this.pool = pool;
    this.ttlSeconds = ttlSeconds;
    this._rows = new Map();
    this._lastLoadedAt = 0;
    this._timer = null;
  }

  _expired() { return !this._lastLoadedAt || (Date.now() - this._lastLoadedAt) >= this.ttlSeconds * 1000; }
  values() { return [...this._rows.values()]; }

  async load(force = false) {
    if (!force && !this._expired()) return this.values();
    try {
      const { rows } = await this.pool.query(`SELECT * FROM mongo_capture_configs WHERE status = 'active' ORDER BY created_at ASC`);
      const next = new Map(rows.map((row) => [row.id, row]));
      for (const [id, row] of next.entries()) if (!this._rows.has(id)) this.emit('added', row);
      for (const [id, row] of this._rows.entries()) if (!next.has(id)) this.emit('removed', row);
      this._rows = next;
      this._lastLoadedAt = Date.now();
      return this.values();
    } catch (error) {
      console.error(`[MongoCaptureConfigCache] reload failed: ${error.message}`);
      return this.values();
    }
  }

  startPolling() { this._timer = setInterval(() => this.load(true), this.ttlSeconds * 1000); this._timer.unref?.(); }
  stopPolling() { if (this._timer) clearInterval(this._timer); this._timer = null; }
}
