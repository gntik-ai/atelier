import Ajv from 'ajv';
import { loadEnv } from '../config/env.mjs';
import { insertAuthRecord } from '../repositories/auth-record-repository.mjs';

const ajv = new Ajv({ allErrors: true, validateFormats: false });

const baseSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: [
    'eventType',
    'tenantId',
    'workspaceId',
    'actorIdentity',
    'channelType',
    'scopesEvaluated',
    'timestamp'
  ],
  properties: {
    eventType: { type: 'string' },
    tenantId: { type: 'string', minLength: 1 },
    workspaceId: { type: 'string', minLength: 1 },
    actorIdentity: { type: 'string', minLength: 1 },
    subscriptionId: { type: 'string' },
    channelType: { type: 'string', minLength: 1 },
    scopesEvaluated: {
      type: 'array',
      items: { type: 'string' }
    },
    filterSnapshot: {
      type: 'object',
      additionalProperties: true
    },
    denialReason: { type: 'string' },
    missingScope: { type: 'string' },
    suspensionReason: {
      type: 'string',
      enum: ['TOKEN_EXPIRED', 'SCOPE_REVOKED']
    },
    resumedAt: { type: 'string', format: 'date-time' },
    timestamp: { type: 'string', format: 'date-time' }
  }
};

export const kafkaSchemas = {
  GRANTED: {
    ...baseSchema,
    properties: {
      ...baseSchema.properties,
      eventType: { const: 'realtime.auth-granted' }
    }
  },
  DENIED: {
    ...baseSchema,
    required: [...baseSchema.required, 'denialReason'],
    properties: {
      ...baseSchema.properties,
      eventType: { const: 'realtime.auth-denied' }
    }
  },
  SUSPENDED: {
    ...baseSchema,
    required: [...baseSchema.required, 'suspensionReason'],
    properties: {
      ...baseSchema.properties,
      eventType: { const: 'realtime.session-suspended' }
    }
  },
  RESUMED: {
    ...baseSchema,
    required: [...baseSchema.required, 'resumedAt'],
    properties: {
      ...baseSchema.properties,
      eventType: { const: 'realtime.session-resumed' }
    }
  }
};

const validators = Object.fromEntries(
  Object.entries(kafkaSchemas).map(([action, schema]) => [action, ajv.compile(schema)])
);

function getTopicForAction(action, env) {
  switch (action) {
    case 'GRANTED':
      return env.AUDIT_KAFKA_TOPIC_AUTH_GRANTED;
    case 'DENIED':
      return env.AUDIT_KAFKA_TOPIC_AUTH_DENIED;
    case 'SUSPENDED':
      return env.AUDIT_KAFKA_TOPIC_SESSION_SUSPENDED;
    case 'RESUMED':
      return env.AUDIT_KAFKA_TOPIC_SESSION_RESUMED;
    default:
      throw new Error(`Unsupported auth action: ${action}`);
  }
}

function getEventType(action) {
  switch (action) {
    case 'GRANTED':
      return 'realtime.auth-granted';
    case 'DENIED':
      return 'realtime.auth-denied';
    case 'SUSPENDED':
      return 'realtime.session-suspended';
    case 'RESUMED':
      return 'realtime.session-resumed';
    default:
      throw new Error(`Unsupported auth action: ${action}`);
  }
}

function buildPayload(decision) {
  return {
    eventType: getEventType(decision.action),
    tenantId: decision.tenantId,
    workspaceId: decision.workspaceId,
    actorIdentity: decision.actorIdentity,
    subscriptionId: decision.subscriptionId,
    channelType: decision.channelType,
    scopesEvaluated: decision.scopesEvaluated ?? [],
    filterSnapshot: decision.filterSnapshot,
    denialReason: decision.denialReason,
    missingScope: decision.missingScope,
    suspensionReason: decision.suspensionReason,
    resumedAt: decision.resumedAt,
    timestamp: decision.timestamp ?? new Date().toISOString()
  };
}

export function createAuditPublisher({
  envProvider = loadEnv,
  insertAuthRecordFn = insertAuthRecord,
  logger = console
} = {}) {
  return async function publishAuthDecision(decision, { kafka, db }) {
    const env = envProvider();
    const payload = buildPayload(decision);
    const validate = validators[decision.action];

    if (!validate) {
      throw new Error(`No schema validator registered for action ${decision.action}`);
    }

    const valid = validate(payload);

    if (!valid) {
      const message = (validate.errors ?? []).map((error) => `${error.instancePath} ${error.message}`.trim()).join('; ');
      throw new Error(`Audit payload failed schema validation: ${message}`);
    }

    await kafka.producer.send({
      topic: getTopicForAction(decision.action, env),
      messages: [{ value: JSON.stringify(payload) }]
    });

    try {
      await insertAuthRecordFn(db, {
        tenantId: payload.tenantId,
        workspaceId: payload.workspaceId,
        actorIdentity: payload.actorIdentity,
        subscriptionId: payload.subscriptionId,
        channelType: payload.channelType,
        action: decision.action,
        denialReason: payload.denialReason,
        suspensionReason: payload.suspensionReason,
        scopesEvaluated: payload.scopesEvaluated,
        filterSnapshot: payload.filterSnapshot,
        timestamp: payload.timestamp
      });
    } catch (error) {
      logger.error?.('Failed to write authorization record to PostgreSQL.', error);
    }
  };
}

export const publishAuthDecision = createAuditPublisher();
