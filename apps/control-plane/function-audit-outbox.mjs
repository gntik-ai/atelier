// Durable publisher for BI-FN-AUD-001.
//
// Function handlers commit their tenant/workspace audit row and one
// `function.audit.events` outbox row in the same PostgreSQL transaction before
// releasing the HTTP response. This worker claims pending rows with
// FOR UPDATE SKIP LOCKED, publishes through KafkaJS (which also retries transient
// sends), and retains failures with bounded exponential backoff. Multiple
// control-plane replicas can run the publisher without claiming the same row.
import { Kafka, logLevel } from 'kafkajs';
import { resolveKafkaSecurity } from './transport-security.mjs';
import { recoverFunctionAuditIntents } from './audit-store.mjs';

const BROKERS = (process.env.KAFKA_BROKERS || 'falcone-kafka:9092').split(',').map((value) => value.trim());
const MAX_BACKOFF_SECONDS = 300;
export const FUNCTION_AUDIT_TOPIC = 'function.audit.events';

export async function ensureFunctionAuditTopic(admin, {
  topic = FUNCTION_AUDIT_TOPIC,
  numPartitions = Number(process.env.FUNCTION_AUDIT_TOPIC_PARTITIONS ?? 3),
  replicationFactor = Number(process.env.FUNCTION_AUDIT_TOPIC_REPLICATION_FACTOR ?? 1),
  retentionMs = String(process.env.FUNCTION_AUDIT_TOPIC_RETENTION_MS ?? 2_592_000_000)
} = {}) {
  const existing = await admin.listTopics();
  if (existing.includes(topic)) return { topic, created: false };
  const created = await admin.createTopics({
    waitForLeaders: true,
    topics: [{
      topic,
      numPartitions,
      replicationFactor,
      configEntries: [{ name: 'retention.ms', value: retentionMs }]
    }]
  });
  return { topic, created: Boolean(created) };
}

async function defaultProducerFactory() {
  const kafka = new Kafka({
    clientId: 'in-falcone-function-audit-outbox',
    brokers: BROKERS,
    logLevel: logLevel.NOTHING,
    retry: { retries: 5, initialRetryTime: 300 },
    ...resolveKafkaSecurity()
  });
  const admin = kafka.admin();
  await admin.connect();
  try {
    await ensureFunctionAuditTopic(admin);
  } finally {
    await admin.disconnect();
  }
  return kafka.producer({ allowAutoTopicCreation: false });
}

function boundedError(error) {
  return String(error?.message ?? error ?? 'unknown Kafka error').slice(0, 500);
}

export async function flushFunctionAuditOutbox(pool, {
  producer,
  batchSize = 50,
  now = () => new Date()
} = {}) {
  if (!producer || typeof producer.send !== 'function') throw new TypeError('connected Kafka producer is required');
  const recovered = await recoverFunctionAuditIntents(pool, { now: now(), limit: batchSize });
  const client = await pool.connect();
  let published = 0;
  let deferred = 0;
  try {
    await client.query('BEGIN');
    const pending = await client.query(
      `SELECT event_id, topic, event_key, payload, attempts
         FROM function_audit_outbox
        WHERE published_at IS NULL AND next_attempt_at <= $1
        ORDER BY created_at, event_id
        FOR UPDATE SKIP LOCKED
        LIMIT $2`,
      [now().toISOString(), batchSize]
    );
    for (const row of pending.rows) {
      try {
        await producer.send({
          topic: row.topic,
          messages: [{ key: row.event_key, value: JSON.stringify(row.payload) }]
        });
        await client.query(
          `UPDATE function_audit_outbox
              SET published_at = $2, attempts = attempts + 1, last_error = NULL
            WHERE event_id = $1`,
          [row.event_id, now().toISOString()]
        );
        published += 1;
      } catch (error) {
        const nextAttempt = new Date(now().getTime()
          + Math.min(MAX_BACKOFF_SECONDS, 2 ** Math.min(Number(row.attempts ?? 0), 8)) * 1000);
        await client.query(
          `UPDATE function_audit_outbox
              SET attempts = attempts + 1, next_attempt_at = $2, last_error = $3
            WHERE event_id = $1`,
          [row.event_id, nextAttempt.toISOString(), boundedError(error)]
        );
        deferred += 1;
      }
    }
    await client.query('COMMIT');
    return { claimed: pending.rows.length, published, deferred, recovered };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  } finally {
    client.release?.();
  }
}

export function startFunctionAuditOutboxPublisher(pool, {
  producerFactory = defaultProducerFactory,
  intervalMs = 5_000,
  logger = console
} = {}) {
  let stopped = false;
  let running = false;
  let producerPromise = null;
  const getProducer = async () => {
    if (!producerPromise) {
      producerPromise = Promise.resolve(producerFactory()).then(async (producer) => {
        await producer.connect();
        return producer;
      }).catch((error) => {
        producerPromise = null;
        throw error;
      });
    }
    return producerPromise;
  };
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try { await flushFunctionAuditOutbox(pool, { producer: await getProducer() }); }
    catch (error) { logger.warn?.(`[control-plane] function audit outbox retry deferred: ${boundedError(error)}`); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();
  void tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    const producer = await producerPromise?.catch(() => null);
    await producer?.disconnect?.();
  };
}
