import { normalizeServiceBaseUrl } from './network.mjs';

const DEFAULTS = Object.freeze({
  kafkaClientId: 'openapi-sdk-service',
  s3Bucket: 'workspace-sdks',
  s3PresignedUrlTtlSeconds: 86400,
  specRateLimitPerMinute: 60,
  sdkRetentionDays: 90,
  nodeEnv: 'development'
});

function readNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (Number.isNaN(value)) throw new Error(`${name} must be numeric`);
  return value;
}

function validateRequired(config) {
  if (config.nodeEnv !== 'production') return;
  const required = [
    ['DATABASE_URL', config.pgConnectionString],
    ['KAFKA_BROKERS', config.kafkaBrokers.length > 0 ? 'set' : ''],
    ['S3_ENDPOINT', config.s3Endpoint],
    ['S3_ACCESS_KEY', config.s3AccessKey],
    ['S3_SECRET_KEY', config.s3SecretKey],
    ['EFFECTIVE_CAPABILITIES_BASE_URL', config.effectiveCapabilitiesBaseUrl]
  ];

  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

export const config = Object.freeze((() => {
  const loaded = {
    pgConnectionString: process.env.DATABASE_URL,
    kafkaBrokers: (process.env.KAFKA_BROKERS || '').split(',').map((value) => value.trim()).filter(Boolean),
    kafkaClientId: process.env.KAFKA_CLIENT_ID || DEFAULTS.kafkaClientId,
    s3Endpoint: process.env.S3_ENDPOINT,
    s3Bucket: process.env.S3_SDK_BUCKET || DEFAULTS.s3Bucket,
    s3AccessKey: process.env.S3_ACCESS_KEY,
    s3SecretKey: process.env.S3_SECRET_KEY,
    s3PresignedUrlTtlSeconds: readNumber('S3_PRESIGNED_URL_TTL_SECONDS', DEFAULTS.s3PresignedUrlTtlSeconds),
    effectiveCapabilitiesBaseUrl: process.env.EFFECTIVE_CAPABILITIES_BASE_URL,
    specRateLimitPerMinute: readNumber('SPEC_RATE_LIMIT_PER_MINUTE', DEFAULTS.specRateLimitPerMinute),
    sdkRetentionDays: readNumber('SDK_RETENTION_DAYS', DEFAULTS.sdkRetentionDays),
    nodeEnv: process.env.NODE_ENV || DEFAULTS.nodeEnv
  };

  validateRequired(loaded);
  if (loaded.effectiveCapabilitiesBaseUrl) {
    loaded.effectiveCapabilitiesBaseUrl = normalizeServiceBaseUrl(
      loaded.effectiveCapabilitiesBaseUrl,
      'EFFECTIVE_CAPABILITIES_BASE_URL',
      { allowBareInternalHttp: true }
    );
  }
  return loaded;
})());
