import dns from 'node:dns';
import net from 'node:net';
import { buildDeliveryAttemptRecord, buildPayloadEnvelope, enforcePayloadSizeLimit } from '../src/webhook-delivery.mjs';
import { deliverySucceededEvent } from '../src/webhook-audit.mjs';
import { computeSignature } from '../src/webhook-signing.mjs';
import { revealSecretRecords } from './webhook-management.mjs';
import { isBlockedIp } from '../src/webhook-subscription.mjs';
import { assertLifecycleVerifiedWebhookKeyContext } from '../src/webhook-master-key.mjs';

async function defaultResolver(hostname) {
  const results = await dns.promises.lookup(hostname, { all: true });
  return results.map((r) => ({ address: r.address, family: r.family }));
}

/**
 * Re-validate the target URL host at delivery time against the SSRF blocklist.
 * Returns { blocked, hostname, pinnedAddress, family } where:
 *   - blocked: true if the connection should be refused
 *   - pinnedAddress: the specific IP to connect to (null if blocked)
 *   - family: 4 or 6
 */
async function resolveDeliveryTarget(targetUrl, resolver) {
  let hostname;
  try {
    hostname = new URL(targetUrl).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return { blocked: true, hostname: null, pinnedAddress: null, family: 4 };
  }

  // IP literal host: check directly, pin to itself
  const ipVersion = net.isIP(hostname);
  if (ipVersion !== 0) {
    const blocked = isBlockedIp(hostname);
    return { blocked, hostname, pinnedAddress: blocked ? null : hostname, family: ipVersion };
  }

  // DNS hostname: resolve fail-closed
  let addresses;
  try {
    addresses = await resolver(hostname);
  } catch {
    return { blocked: true, hostname, pinnedAddress: null, family: 4 };
  }
  if (!addresses || addresses.length === 0) {
    return { blocked: true, hostname, pinnedAddress: null, family: 4 };
  }

  // Normalise: resolver may return strings (legacy) or {address,family} objects
  const entries = addresses.map((a) => {
    if (typeof a === 'string') return { address: a, family: net.isIP(a) === 6 ? 6 : 4 };
    return { address: a.address, family: a.family ?? (net.isIP(a.address) === 6 ? 6 : 4) };
  });

  // Fail-closed if any address is blocked
  if (entries.some((e) => isBlockedIp(e.address))) {
    return { blocked: true, hostname, pinnedAddress: null, family: 4 };
  }

  // Pin to the first non-blocked address
  const first = entries[0];
  return { blocked: false, hostname, pinnedAddress: first.address, family: first.family };
}

/**
 * Default dispatcher factory — lazily imports undici so the module loads
 * without undici installed (tests inject a fake factory). Only invoked in
 * production where undici is available.
 */
async function defaultDispatcherFactory({ address, family }) {
  const { Agent } = await import('undici');
  return new Agent({
    connect: {
      lookup: (_hostname, _opts, cb) => cb(null, [{ address, family }])
    }
  });
}

export async function main(params) {
  const {
    db,
    kafka,
    scheduler,
    http = fetch,
    deliveryId,
    keyContext,
    env = process.env,
    resolver: paramResolver,
    dispatcherFactory = defaultDispatcherFactory
  } = params;
  assertLifecycleVerifiedWebhookKeyContext(keyContext);

  const resolver = paramResolver ?? defaultResolver;

  const delivery = await db.getDeliveryById(deliveryId);
  const subscription = await db.getSubscription(delivery.subscription_id);
  // Scope the secret lookup to the owning tenant. The injected db layer applies
  // an AND tenant_id = $N AND workspace_id = $M predicate so that a known or
  // guessed subscription_id alone can never load another tenant's secrets into
  // the signing context.
  const secretRows = revealSecretRecords(
    await db.listSecrets(subscription.id, subscription.tenant_id, subscription.workspace_id),
    keyContext,
  );
  const secret = secretRows.find((row) => row.status === 'active') ?? secretRows[0];
  const event = await db.getEvent(delivery.event_id);
  const payloadEnvelope = buildPayloadEnvelope(delivery, event);
  const payloadResult = enforcePayloadSizeLimit(payloadEnvelope, Number(env.WEBHOOK_MAX_PAYLOAD_BYTES ?? 524288));
  const rawBody = JSON.stringify(payloadResult.payload);
  const attemptNum = (delivery.attempt_count ?? 0) + 1;

  // Delivery-time SSRF re-validation (DNS-rebinding defense) + IP pinning
  const resolved = await resolveDeliveryTarget(subscription.target_url, resolver);
  if (resolved.blocked) {
    await db.insertAttempt(buildDeliveryAttemptRecord(delivery.id, attemptNum, 'blocked', { errorDetail: 'SSRF guard: target resolved to blocked address' }));
    await db.updateDelivery(delivery.id, { status: 'permanently_failed', attempt_count: attemptNum });
    return { status: 'permanently_failed', reason: 'ssrf_blocked' };
  }

  // Build a dispatcher pinned to the validated IP to prevent TOCTOU re-resolution
  const dispatcher = await dispatcherFactory({ address: resolved.pinnedAddress, family: resolved.family });

  const startedAt = Date.now();
  try {
    const response = await http(subscription.target_url, {
      method: 'POST',
      redirect: 'manual',
      dispatcher,
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

    // Redirect guard (req-3): validate Location before even considering following
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        const redirectResolved = await resolveDeliveryTarget(location, resolver);
        if (redirectResolved.blocked) {
          await db.insertAttempt(buildDeliveryAttemptRecord(delivery.id, attemptNum, 'blocked', { httpStatus: response.status, responseMs, errorDetail: 'SSRF guard: redirect location resolved to blocked address' }));
          await db.updateDelivery(delivery.id, { status: 'permanently_failed', attempt_count: attemptNum });
          return { status: 'permanently_failed', reason: 'ssrf_redirect_blocked' };
        }
      }
      // Redirect to safe target: treat as non-2xx failure (retry)
      await db.insertAttempt(buildDeliveryAttemptRecord(delivery.id, attemptNum, 'failed', { httpStatus: response.status, responseMs }));
      await db.updateDelivery(delivery.id, { status: 'failed', attempt_count: attemptNum });
      return scheduler.main({ db, kafka, invoker: scheduler.invoker, deliveryId: delivery.id, attemptCount: attemptNum, env });
    }

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
