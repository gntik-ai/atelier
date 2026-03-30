const REQUIRED_STRING_KEYS = [
  'KEYCLOAK_JWKS_URL',
  'KEYCLOAK_INTROSPECTION_URL',
  'KEYCLOAK_INTROSPECTION_CLIENT_ID',
  'KEYCLOAK_INTROSPECTION_CLIENT_SECRET',
  'DATABASE_URL',
  'KAFKA_BROKERS'
];

const DEFAULTS = {
  JWKS_CACHE_TTL_SECONDS: 300,
  SCOPE_REVALIDATION_INTERVAL_SECONDS: 30,
  TOKEN_EXPIRY_GRACE_SECONDS: 30,
  MAX_FILTER_PREDICATES: 10,
  MAX_SUBSCRIPTIONS_PER_WORKSPACE: 50,
  AUDIT_KAFKA_TOPIC_AUTH_GRANTED: 'console.realtime.auth-granted',
  AUDIT_KAFKA_TOPIC_AUTH_DENIED: 'console.realtime.auth-denied',
  AUDIT_KAFKA_TOPIC_SESSION_SUSPENDED: 'console.realtime.session-suspended',
  AUDIT_KAFKA_TOPIC_SESSION_RESUMED: 'console.realtime.session-resumed',
  REALTIME_AUTH_ENABLED: 'true'
};

function assertNonEmptyString(value, key) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value.trim();
}

function parsePositiveInteger(rawValue, key, fallback) {
  const value = rawValue ?? fallback;
  const parsed = Number.parseInt(String(value), 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Environment variable ${key} must be a non-negative integer.`);
  }

  return parsed;
}

function parseUrl(rawValue, key) {
  const value = assertNonEmptyString(rawValue, key);

  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`Environment variable ${key} must be a valid URL.`);
  }
}

function parseBrokerList(rawValue) {
  const value = assertNonEmptyString(rawValue, 'KAFKA_BROKERS');
  const brokers = value.split(',').map((item) => item.trim()).filter(Boolean);

  if (brokers.length === 0) {
    throw new Error('Environment variable KAFKA_BROKERS must contain at least one broker.');
  }

  return brokers;
}

export function loadEnv(source = process.env) {
  for (const key of REQUIRED_STRING_KEYS) {
    assertNonEmptyString(source[key], key);
  }

  const realtimeAuthEnabled = String(source.REALTIME_AUTH_ENABLED ?? DEFAULTS.REALTIME_AUTH_ENABLED).toLowerCase();

  if (!['true', 'false'].includes(realtimeAuthEnabled)) {
    throw new Error('Environment variable REALTIME_AUTH_ENABLED must be either true or false.');
  }

  return {
    KEYCLOAK_JWKS_URL: parseUrl(source.KEYCLOAK_JWKS_URL, 'KEYCLOAK_JWKS_URL'),
    KEYCLOAK_INTROSPECTION_URL: parseUrl(source.KEYCLOAK_INTROSPECTION_URL, 'KEYCLOAK_INTROSPECTION_URL'),
    KEYCLOAK_INTROSPECTION_CLIENT_ID: assertNonEmptyString(source.KEYCLOAK_INTROSPECTION_CLIENT_ID, 'KEYCLOAK_INTROSPECTION_CLIENT_ID'),
    KEYCLOAK_INTROSPECTION_CLIENT_SECRET: assertNonEmptyString(source.KEYCLOAK_INTROSPECTION_CLIENT_SECRET, 'KEYCLOAK_INTROSPECTION_CLIENT_SECRET'),
    DATABASE_URL: assertNonEmptyString(source.DATABASE_URL, 'DATABASE_URL'),
    KAFKA_BROKERS: parseBrokerList(source.KAFKA_BROKERS),
    JWKS_CACHE_TTL_SECONDS: parsePositiveInteger(source.JWKS_CACHE_TTL_SECONDS, 'JWKS_CACHE_TTL_SECONDS', DEFAULTS.JWKS_CACHE_TTL_SECONDS),
    SCOPE_REVALIDATION_INTERVAL_SECONDS: parsePositiveInteger(source.SCOPE_REVALIDATION_INTERVAL_SECONDS, 'SCOPE_REVALIDATION_INTERVAL_SECONDS', DEFAULTS.SCOPE_REVALIDATION_INTERVAL_SECONDS),
    TOKEN_EXPIRY_GRACE_SECONDS: parsePositiveInteger(source.TOKEN_EXPIRY_GRACE_SECONDS, 'TOKEN_EXPIRY_GRACE_SECONDS', DEFAULTS.TOKEN_EXPIRY_GRACE_SECONDS),
    MAX_FILTER_PREDICATES: parsePositiveInteger(source.MAX_FILTER_PREDICATES, 'MAX_FILTER_PREDICATES', DEFAULTS.MAX_FILTER_PREDICATES),
    MAX_SUBSCRIPTIONS_PER_WORKSPACE: parsePositiveInteger(source.MAX_SUBSCRIPTIONS_PER_WORKSPACE, 'MAX_SUBSCRIPTIONS_PER_WORKSPACE', DEFAULTS.MAX_SUBSCRIPTIONS_PER_WORKSPACE),
    AUDIT_KAFKA_TOPIC_AUTH_GRANTED: source.AUDIT_KAFKA_TOPIC_AUTH_GRANTED ?? DEFAULTS.AUDIT_KAFKA_TOPIC_AUTH_GRANTED,
    AUDIT_KAFKA_TOPIC_AUTH_DENIED: source.AUDIT_KAFKA_TOPIC_AUTH_DENIED ?? DEFAULTS.AUDIT_KAFKA_TOPIC_AUTH_DENIED,
    AUDIT_KAFKA_TOPIC_SESSION_SUSPENDED: source.AUDIT_KAFKA_TOPIC_SESSION_SUSPENDED ?? DEFAULTS.AUDIT_KAFKA_TOPIC_SESSION_SUSPENDED,
    AUDIT_KAFKA_TOPIC_SESSION_RESUMED: source.AUDIT_KAFKA_TOPIC_SESSION_RESUMED ?? DEFAULTS.AUDIT_KAFKA_TOPIC_SESSION_RESUMED,
    REALTIME_AUTH_ENABLED: realtimeAuthEnabled === 'true'
  };
}
