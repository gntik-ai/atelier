import { Kafka } from 'kafkajs';
import pg from 'pg';

const { Client } = pg;

async function checkVaultHealth() {
  if (!process.env.VAULT_ADDR) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${process.env.VAULT_ADDR.replace(/\/$/, '')}/v1/sys/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

async function checkKafkaHealth() {
  const brokers = (process.env.KAFKA_BROKERS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!brokers.length) return false;
  const kafka = new Kafka({ clientId: 'hardening-healthcheck', brokers, connectionTimeout: 3000, requestTimeout: 3000 });
  const admin = kafka.admin();
  try {
    await admin.connect();
    return true;
  } catch {
    return false;
  } finally {
    await admin.disconnect().catch(() => {});
  }
}

async function checkPostgresHealth() {
  if (!process.env.DATABASE_URL) return false;
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

export async function detectEnforcementMode() {
  const [vaultReachable, kafkaReachable, postgresReachable] = await Promise.all([
    checkVaultHealth(),
    checkKafkaHealth(),
    checkPostgresHealth(),
  ]);

  return {
    scopeEnforcement: process.env.SCOPE_ENFORCEMENT_ENABLED !== 'false',
    privilegeDomain: process.env.PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED !== 'false',
    vaultReachable,
    kafkaReachable,
    postgresReachable,
  };
}
