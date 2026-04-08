/**
 * Test environment configuration for plan enforcement coherence suite.
 * Reads all required and optional env vars with sensible local defaults.
 */

const REQUIRED = [
  'GATEWAY_BASE_URL',
  'CONTROL_PLANE_URL',
  'KEYCLOAK_URL',
  'SUPERADMIN_CLIENT_ID',
  'SUPERADMIN_CLIENT_SECRET',
];

const missing = REQUIRED.filter((k) => !process.env[k]);

// Validation is deferred: warn but don't throw at import time so that
// syntax-check (`node --check`) and non-integration runs don't fail.
if (missing.length > 0) {
  const msg = `plan-enforcement: required env vars missing: ${missing.join(', ')}`;
  if (process.env.PLAN_ENFORCEMENT_STRICT === 'true') {
    throw new Error(msg);
  }
  // eslint-disable-next-line no-console
  console.warn(`warning: ${msg} — integration tests will self-skip.`);
}

/** @type {boolean} */
export const envReady = missing.length === 0;

export const env = Object.freeze({
  // Core service URLs
  GATEWAY_BASE_URL: process.env.GATEWAY_BASE_URL ?? 'http://localhost:9080',
  CONTROL_PLANE_URL: process.env.CONTROL_PLANE_URL ?? 'http://localhost:3233',
  CONSOLE_API_URL: process.env.CONSOLE_API_URL ?? 'http://localhost:3000/api',
  KEYCLOAK_URL: process.env.KEYCLOAK_URL ?? 'http://localhost:8080',
  KEYCLOAK_REALM: process.env.KEYCLOAK_REALM ?? 'falcone',

  // Superadmin credentials (client credentials grant)
  SUPERADMIN_CLIENT_ID: process.env.SUPERADMIN_CLIENT_ID ?? '',
  SUPERADMIN_CLIENT_SECRET: process.env.SUPERADMIN_CLIENT_SECRET ?? '',

  // Kafka
  KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? 'localhost:9092',
  KAFKA_AUDIT_TOPIC: process.env.KAFKA_AUDIT_TOPIC ?? 'platform.audit.events',

  // Propagation
  PROPAGATION_TTL_MS: Number(process.env.PROPAGATION_TTL_MS) || 30_000,
  PROPAGATION_POLL_MS: Number(process.env.PROPAGATION_POLL_MS) || 500,

  // Test identity
  TEST_TENANT_PREFIX: process.env.TEST_TENANT_PREFIX ?? 'test-t06',

  // Browser tests
  BROWSER_TEST_ENABLED: process.env.BROWSER_TEST_ENABLED === 'true',
  PLAYWRIGHT_BASE_URL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',

  // Result output
  TEST_RESULT_OUTPUT_PATH:
    process.env.TEST_RESULT_OUTPUT_PATH ??
    'test-results/plan-enforcement-report.json',
});
