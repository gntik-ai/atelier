import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Kafka } from 'kafkajs';
import pg from 'pg';

const { Pool } = pg;

function parseBrokers() {
  return (process.env.KAFKA_BROKERS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function waitForAuditEvent({ pgTable, filter = {}, timeoutMs = 5000, pollIntervalMs = 200 }) {
  if (!process.env.DATABASE_URL) {
    return { found: false, eventData: null };
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: Math.min(timeoutMs, 3000),
  });

  try {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const conditions = [];
      const values = [];
      let index = 1;

      for (const [key, value] of Object.entries(filter)) {
        if (value === undefined || value === null) continue;
        if (key === 'requestTimeAfter') {
          conditions.push(`created_at > $${index++}`);
          values.push(value instanceof Date ? value.toISOString() : value);
          continue;
        }
        conditions.push(`${camelToSnake(key)} = $${index++}`);
        values.push(value);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const query = `SELECT * FROM ${pgTable} ${whereClause} ORDER BY created_at DESC LIMIT 1`;
      const result = await pool.query(query, values);
      if (result.rows[0]) {
        return { found: true, eventData: result.rows[0] };
      }
      await delay(pollIntervalMs);
    }

    console.warn(`[HARDENING] WARN: audit event timeout on ${pgTable} after ${timeoutMs}ms`);
    return { found: false, eventData: null };
  } catch (error) {
    console.warn(`[HARDENING] WARN: audit verifier failed for ${pgTable}: ${error.message}`);
    return { found: false, eventData: null };
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function waitForKafkaEvent({ topic, filter = {}, timeoutMs = 5000 }) {
  const brokers = parseBrokers();
  if (!brokers.length) {
    return { found: false, eventData: null };
  }

  const kafka = new Kafka({ clientId: 'hardening-tests', brokers });
  const consumer = kafka.consumer({ groupId: `hardening-${randomUUID()}-${Date.now()}` });
  let timeoutHandle;

  try {
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: false });

    return await new Promise((resolve) => {
      timeoutHandle = setTimeout(() => {
        console.warn(`[HARDENING] WARN: kafka event timeout on ${topic} after ${timeoutMs}ms`);
        resolve({ found: false, eventData: null });
      }, timeoutMs);

      consumer.run({
        eachMessage: async ({ message }) => {
          const value = message.value?.toString() ?? '';
          let parsed = value;
          try {
            parsed = JSON.parse(value);
          } catch {}

          const matched = Object.entries(filter).every(([key, expected]) => parsed?.[key] === expected);
          if (matched) {
            clearTimeout(timeoutHandle);
            resolve({ found: true, eventData: parsed });
          }
        },
      }).catch(() => {
        clearTimeout(timeoutHandle);
        resolve({ found: false, eventData: null });
      });
    });
  } catch (error) {
    console.warn(`[HARDENING] WARN: kafka verifier failed for ${topic}: ${error.message}`);
    return { found: false, eventData: null };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    await consumer.disconnect().catch(() => {});
  }
}

function camelToSnake(value) {
  return value.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}
