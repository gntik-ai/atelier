import { buildDeliveryAttemptRecord, buildPayloadEnvelope, enforcePayloadSizeLimit } from '../src/webhook-delivery.mjs';
import { deliverySucceededEvent } from '../src/webhook-audit.mjs';
import { computeSignature } from '../src/webhook-signing.mjs';
import { revealSecretRecords } from './webhook-management.mjs';

export async function main(params) {
  const { db, kafka, scheduler, http = fetch, deliveryId, env = process.env } = params;
  const delivery = await db.getDeliveryById(deliveryId);
  const subscription = await db.getSubscription(delivery.subscription_id);
  const secretRows = revealSecretRecords(await db.listSecrets(subscription.id), env);
  const secret = secretRows.find((row) => row.status === 'active') ?? secretRows[0];
  const event = await db.getEvent(delivery.event_id);
  const payloadEnvelope = buildPayloadEnvelope(delivery, event);
  const payloadResult = enforcePayloadSizeLimit(payloadEnvelope, Number(env.WEBHOOK_MAX_PAYLOAD_BYTES ?? 524288));
  const rawBody = JSON.stringify(payloadResult.payload);
  const attemptNum = (delivery.attempt_count ?? 0) + 1;
  const startedAt = Date.now();
  try {
    const response = await http(subscription.target_url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        'x-platform-webhook-id': delivery.id,
        'x-platform-webhook-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-platform-webhook-event': delivery.event_type,
        'x-platform-webhook-signature': computeSignature(rawBody, secret.secret),
        'x-platform-webhook-attempt': String(attemptNum),
        'user-agent': 'PlatformWebhook/1.0'
      },
      body: rawBody,
      signal: AbortSignal.timeout(Number(env.WEBHOOK_RESPONSE_TIMEOUT_MS ?? 30000))
    });
    const responseMs = Date.now() - startedAt;
    if (response.status >= 200 && response.status < 300) {
      await db.insertAttempt(buildDeliveryAttemptRecord(delivery.id, attemptNum, 'succeeded', { httpStatus: response.status, responseMs }));
      await db.updateDelivery(delivery.id, { status: 'succeeded', attempt_count: attemptNum, payload_ref: payloadResult.payload_ref, payload_size: payloadResult.payload_size });
      const ctx = { tenantId: delivery.tenant_id, workspaceId: delivery.workspace_id, actorId: 'system' };
      await kafka?.publish?.('console.webhook.delivery.succeeded', deliverySucceededEvent(ctx, delivery.id));
      return { status: 'succeeded', headers: response.ok ? Object.fromEntries(response.headers.entries()) : {} };
    }
    await db.insertAttempt(buildDeliveryAttemptRecord(delivery.id, attemptNum, 'failed', { httpStatus: response.status, responseMs }));
    await db.updateDelivery(delivery.id, { status: 'failed', attempt_count: attemptNum });
    return scheduler.main({ db, kafka, invoker: scheduler.invoker, deliveryId: delivery.id, attemptCount: attemptNum, env });
  } catch (caught) {
    await db.insertAttempt(buildDeliveryAttemptRecord(delivery.id, attemptNum, 'timed_out', { errorDetail: caught.message }));
    await db.updateDelivery(delivery.id, { status: 'failed', attempt_count: attemptNum });
    return scheduler.main({ db, kafka, invoker: scheduler.invoker, deliveryId: delivery.id, attemptCount: attemptNum, env });
  }
}
