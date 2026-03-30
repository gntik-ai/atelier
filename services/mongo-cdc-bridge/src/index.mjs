import pg from 'pg';
import { Kafka } from 'kafkajs';
import { MongoClient } from 'mongodb';
import { MongoCaptureConfigCache } from './MongoCaptureConfigCache.mjs';
import { ResumeTokenStore } from './ResumeTokenStore.mjs';
import { KafkaChangePublisher } from './KafkaChangePublisher.mjs';
import { ChangeStreamManager } from './ChangeStreamManager.mjs';
import { MetricsCollector } from './MetricsCollector.mjs';
import { HealthServer } from './HealthServer.mjs';
const { Pool } = pg;

if (!process.env.MONGO_CDC_PG_CONNECTION_STRING) throw new Error('MONGO_CDC_PG_CONNECTION_STRING_REQUIRED');
if (!process.env.MONGO_CDC_KAFKA_BROKERS) throw new Error('MONGO_CDC_KAFKA_BROKERS_REQUIRED');

const pool = new Pool({ connectionString: process.env.MONGO_CDC_PG_CONNECTION_STRING });
const kafka = new Kafka({ clientId: process.env.MONGO_CDC_KAFKA_CLIENT_ID ?? 'mongo-cdc-bridge', brokers: process.env.MONGO_CDC_KAFKA_BROKERS.split(',').filter(Boolean) });
const metricsCollector = new MetricsCollector();
const kafkaPublisher = new KafkaChangePublisher({ kafka, metricsCollector });
await kafkaPublisher.connect();
const configCache = new MongoCaptureConfigCache({ pool, ttlSeconds: Number(process.env.MONGO_CDC_CACHE_TTL_SECONDS ?? 30) });
const resumeTokenStore = new ResumeTokenStore(pool);
const manager = new ChangeStreamManager({
  pool,
  configCache,
  resumeTokenStore,
  kafkaPublisher,
  mongoClientFactory: async (config) => MongoClient.connect(config.mongo_uri ?? process.env.MONGO_TEST_URI ?? process.env.MONGO_URI),
  statusUpdater: async (captureId, status, lastError) => pool.query('UPDATE mongo_capture_configs SET status=$2, last_error=$3, updated_at=now() WHERE id=$1', [captureId, status, lastError]),
  auditCallback: async (action, config, _rawDoc, detail) => pool.query('INSERT INTO mongo_capture_audit_log (capture_id, tenant_id, workspace_id, actor_identity, action, after_state) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [config.id, config.tenant_id, config.workspace_id, config.actor_identity, action, JSON.stringify(detail ?? null)])
});
const healthServer = new HealthServer({ port: Number(process.env.MONGO_CDC_HEALTH_PORT ?? 8080), manager, metricsCollector });
await manager.start();
healthServer.start();
const shutdown = async () => { await manager.shutdown(); await healthServer.close(); await pool.end(); process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
