export const FORBIDDEN_FIELDS = ['value', 'data', 'secret', 'password', 'token', 'key'];

export const SecretAuditEvent = {
  type: 'object',
  required: ['eventId', 'timestamp', 'operation', 'domain', 'secretPath', 'secretName', 'requestorIdentity', 'result', 'vaultRequestId'],
  properties: {
    eventId: { type: 'string', format: 'uuid' },
    timestamp: { type: 'string', format: 'date-time' },
    operation: { enum: ['read', 'write', 'delete', 'denied'] },
    domain: { enum: ['platform', 'tenant', 'functions', 'gateway', 'iam'] },
    secretPath: { type: 'string' },
    secretName: { type: 'string' },
    requestorIdentity: {
      type: 'object',
      required: ['type', 'name', 'namespace', 'serviceAccount'],
      properties: {
        type: { enum: ['service', 'user'] },
        name: { type: 'string' },
        namespace: { type: 'string' },
        serviceAccount: { type: 'string' }
      }
    },
    result: { enum: ['success', 'denied', 'error'] },
    denialReason: { type: ['string', 'null'] },
    vaultRequestId: { type: 'string' }
  },
  additionalProperties: false
};

export function hasForbiddenField(input) {
  if (!input || typeof input !== 'object') return false;
  return Object.entries(input).some(([key, value]) => {
    const normalized = key.toLowerCase();
    const forbidden = FORBIDDEN_FIELDS.some((field) => normalized === field || normalized.endsWith(`.${field}`));
    return forbidden || hasForbiddenField(value);
  });
}

export function validateAuditEvent(event) {
  if (hasForbiddenField(event)) {
    throw new Error('Forbidden secret material detected in audit event');
  }
  for (const field of SecretAuditEvent.required) {
    if (!(field in event)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  return true;
}
