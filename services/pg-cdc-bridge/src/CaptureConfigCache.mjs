export class CaptureConfigCache {
  constructor({ pool, ttlSeconds = Number(process.env.PG_CDC_CACHE_TTL_SECONDS ?? 30) }) { this.pool = pool; this.ttlSeconds = ttlSeconds; this._cache = new Map(); }
  async getActiveConfigs(dataSourceRef) {
    const now = Date.now();
    const cached = this._cache.get(dataSourceRef);
    if (cached && cached.expiresAt > now) return cached.rows;
    try {
      const { rows } = await this.pool.query(`SELECT * FROM pg_capture_configs WHERE data_source_ref = $1 AND status = 'active'`, [dataSourceRef]);
      this._cache.set(dataSourceRef, { rows, expiresAt: now + this.ttlSeconds * 1000 });
      return rows;
    } catch (error) {
      console.error(`[CaptureConfigCache] reload failed: ${error.message}`);
      return cached?.rows ?? [];
    }
  }
  invalidate(dataSourceRef) { this._cache.delete(dataSourceRef); }
}
