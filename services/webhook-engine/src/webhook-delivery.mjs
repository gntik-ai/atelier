import crypto from 'node:crypto';

function uuid() {
  return crypto.randomUUID();
}

export function buildDeliveryRecord(subscription, event, config = {}) {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    subscription_id: subscription.id,
    tenant_id: subscription.tenant_id,
    workspace_id: subscription.workspace_id,
    event_type: event.eventType,
    event_id: event.eventId,
    payload_ref: null,
    payload_size: Buffer.byteLength(JSON.stringify(event.data ?? {})),
    status: 'pending',
    attempt_count: 0,
    max_attempts: config.maxAttempts ?? 5,
    next_attempt_at: now,
    created_at: now,
    updated_at: now
  };
}

export function buildDeliveryAttemptRecord(deliveryId, attemptNum, outcome, extras = {}) {
  return {
    id: uuid(),
    delivery_id: deliveryId,
    attempt_num: attemptNum,
    attempted_at: new Date().toISOString(),
    http_status: extras.httpStatus ?? null,
    response_ms: extras.responseMs ?? null,
    error_detail: extras.errorDetail ?? null,
    outcome
  };
}

export function isTerminal(delivery) {
  return ['succeeded', 'permanently_failed', 'cancelled'].includes(delivery.status);
}

export function shouldAutoDisable(subscription, consecutiveFailuresThreshold) {
  return (subscription.consecutive_failures ?? 0) >= consecutiveFailuresThreshold;
}

export function buildPayloadEnvelope(delivery, event) {
  return {
    id: delivery.id,
    timestamp: new Date().toISOString(),
    eventType: delivery.event_type,
    workspaceId: delivery.workspace_id,
    data: event.data ?? {}
  };
}

export function enforcePayloadSizeLimit(payload, maxBytes) {
  const raw = Buffer.from(JSON.stringify(payload));
  if (raw.byteLength <= maxBytes) {
    return { payload, payload_ref: null, payload_size: raw.byteLength, truncated: false };
  }
  const data = { ...payload.data, _truncated: true };
  const truncatedPayload = { ...payload, data };
  return {
    payload: truncatedPayload,
    payload_ref: `s3://webhook-payloads/${uuid()}`,
    payload_size: raw.byteLength,
    truncated: true
  };
}
