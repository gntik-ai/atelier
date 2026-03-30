import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import pg from 'pg';
const { Client } = pg;
export class PgWalListener extends EventEmitter {
  constructor({ connectionString, dataSourceRef, decoder, routeFilter, publisher, slotName }) { super(); this.connectionString = connectionString; this.dataSourceRef = dataSourceRef; this.decoder = decoder; this.routeFilter = routeFilter; this.publisher = publisher; this.slotName = slotName ?? `cdc_${crypto.createHash('sha1').update(dataSourceRef).digest('hex').slice(0, 8)}`; this._running = false; }
  get isRunning() { return this._running; }
  async start() {
    this.client = new Client({ connectionString: this.connectionString, replication: 'database' });
    await this.client.connect();
    try { await this.client.query(`CREATE_REPLICATION_SLOT ${this.slotName} LOGICAL pgoutput`); } catch (error) { if (error.code !== '42710') throw error; }
    this._running = true;
  }
  async processMessage(buffer, lsn, committedAt = new Date().toISOString()) {
    const decoded = this.decoder.decodeMessage(buffer, lsn);
    if (!decoded?.relation) return null;
    const matches = await this.routeFilter.match(decoded, this.dataSourceRef);
    await Promise.all(matches.map((config) => this.publisher.publish(config, decoded, lsn, committedAt)));
    this.lastAckedLsn = lsn;
    return matches.length;
  }
  async stop() { this._running = false; await this.client?.end?.(); }
}
