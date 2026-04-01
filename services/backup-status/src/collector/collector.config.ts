/**
 * Collector configuration — reads from environment variables.
 */

export interface CollectorConfig {
  intervalMs: number
  adapterTimeoutMs: number
  staleThresholdMinutes: number
}

export function loadConfig(): CollectorConfig {
  return {
    intervalMs: parseInt(process.env.BACKUP_COLLECTOR_INTERVAL_MS ?? '300000', 10),
    adapterTimeoutMs: parseInt(process.env.BACKUP_ADAPTER_TIMEOUT_MS ?? '10000', 10),
    staleThresholdMinutes: parseInt(process.env.BACKUP_STALE_THRESHOLD_MINUTES ?? '15', 10),
  }
}
