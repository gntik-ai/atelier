import { EVENT_CATALOGUE } from '../src/event-catalogue.mjs';
import { subscriptionCreatedEvent, subscriptionDeletedEvent, subscriptionPausedEvent, subscriptionResumedEvent, subscriptionUpdatedEvent, secretRotatedEvent } from '../src/webhook-audit.mjs';
import { buildSubscriptionRecord, applyStatusTransition, softDelete, validateSubscriptionInput } from '../src/webhook-subscription.mjs';
import { checkSubscriptionQuota, getQuotaConfig } from '../src/webhook-quota.mjs';
import { decryptSecret, encryptSecret, generateSigningSecret } from '../src/webhook-signing.mjs';

function ok(statusCode, body) { return { statusCode, body }; }
function noContent() { return { statusCode: 204, body: null }; }
function error(statusCode, code, message) { return { statusCode, body: { code, message } }; }

function pathParts(path) {
  return String(path || '').replace(/^\/v1\/webhooks\/?/, '').split('/').filter(Boolean);
}

async function publish(kafka, topic, message) {
  if (kafka?.publish) await kafka.publish(topic, message);
}

function responseSubscription(row) {
  return {
    subscriptionId: row.id,
    targetUrl: row.target_url,
    eventTypes: row.event_types,
    description: row.description ?? null,
    status: row.status,
    consecutiveFailures: row.consecutive_failures,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function requireSubscription(db, ctx, id) {
  const row = await db.getSubscription(id);
  if (!row || row.tenant_id !== ctx.tenantId || row.workspace_id !== ctx.workspaceId || row.deleted_at) return null;
  return row;
}

export async function main(params) {
  const { db, kafka, env = process.env, method = 'GET', path = '/', body = {}, query = {}, auth = {} } = params;
  const ctx = { tenantId: auth.tenantId, workspaceId: auth.workspaceId, actorId: auth.actorId };
  const parts = pathParts(path);
  const quotaConfig = getQuotaConfig(env);
  const signingKey = env.WEBHOOK_SIGNING_KEY ?? 'development-signing-key';

  if (method === 'GET' && parts[0] === 'event-types') return ok(200, { eventTypes: EVENT_CATALOGUE });

  if (parts[0] !== 'subscriptions') return error(404, 'NOT_FOUND', 'Route not found');

  if (method === 'POST' && parts.length === 1) {
    try {
      const currentCount = await db.getWorkspaceSubscriptionCount(ctx.tenantId, ctx.workspaceId);
      if (!checkSubscriptionQuota(ctx.workspaceId, currentCount, quotaConfig.maxSubscriptionsPerWorkspace).allowed) {
        return error(409, 'QUOTA_EXCEEDED', 'Workspace subscription quota reached');
      }
      const record = buildSubscriptionRecord(body, ctx);
      const signingSecret = generateSigningSecret();
      const encrypted = encryptSecret(signingSecret, signingKey);
      await db.insertSubscription(record);
      await db.insertSecret(record.id, encrypted);
      await publish(kafka, 'console.webhook.subscription.created', subscriptionCreatedEvent(ctx, record.id));
      return ok(201, { ...responseSubscription(record), signingSecret });
    } catch (caught) {
      return error(400, caught.code ?? 'BAD_REQUEST', caught.message);
    }
  }

  if (method === 'GET' && parts.length === 1) {
    const rows = await db.listSubscriptions(ctx, query);
    return ok(200, { items: rows.map(responseSubscription), nextCursor: null });
  }

  const subscriptionId = parts[1];
  const subscription = await requireSubscription(db, ctx, subscriptionId);
  if (!subscription) return error(404, 'NOT_FOUND', 'Subscription not found');

  if (method === 'GET' && parts.length === 2) return ok(200, responseSubscription(subscription));

  if (method === 'PATCH' && parts.length === 2) {
    try {
      const validated = validateSubscriptionInput({ targetUrl: body.targetUrl ?? subscription.target_url, eventTypes: body.eventTypes ?? subscription.event_types });
      const updated = await db.updateSubscription(subscription.id, { ...body, target_url: validated.targetUrl, event_types: validated.eventTypes });
      await publish(kafka, 'console.webhook.subscription.updated', subscriptionUpdatedEvent(ctx, subscription.id));
      return ok(200, responseSubscription(updated));
    } catch (caught) {
      return error(400, caught.code ?? 'BAD_REQUEST', caught.message);
    }
  }

  if (method === 'POST' && parts[2] === 'pause') {
    try {
      const updated = await db.replaceSubscription(applyStatusTransition(subscription, 'paused'));
      await publish(kafka, 'console.webhook.subscription.paused', subscriptionPausedEvent(ctx, subscription.id));
      return ok(200, responseSubscription(updated));
    } catch (caught) {
      return error(409, caught.code ?? 'INVALID_STATUS_TRANSITION', caught.message);
    }
  }

  if (method === 'POST' && parts[2] === 'resume') {
    try {
      const updated = await db.replaceSubscription(applyStatusTransition(subscription, 'active'));
      await publish(kafka, 'console.webhook.subscription.resumed', subscriptionResumedEvent(ctx, subscription.id));
      return ok(200, responseSubscription(updated));
    } catch (caught) {
      return error(409, caught.code ?? 'INVALID_STATUS_TRANSITION', caught.message);
    }
  }

  if (method === 'DELETE' && parts.length === 2) {
    const deleted = await db.replaceSubscription(softDelete(subscription));
    await db.cancelPendingDeliveries(subscription.id);
    await publish(kafka, 'console.webhook.subscription.deleted', subscriptionDeletedEvent(ctx, subscription.id));
    return noContent(deleted);
  }

  if (method === 'POST' && parts[2] === 'rotate-secret') {
    const gracePeriodSeconds = Number(body.gracePeriodSeconds ?? env.WEBHOOK_SECRET_GRACE_PERIOD_SECONDS ?? 86400);
    const newSigningSecret = generateSigningSecret();
    const encrypted = encryptSecret(newSigningSecret, signingKey);
    const graceExpiresAt = new Date(Date.now() + (gracePeriodSeconds * 1000)).toISOString();
    await db.rotateSecret(subscription.id, encrypted, graceExpiresAt);
    await publish(kafka, 'console.webhook.secret.rotated', secretRotatedEvent(ctx, subscription.id));
    return ok(200, { newSigningSecret, gracePeriodSeconds, graceExpiresAt });
  }

  if (method === 'GET' && parts[2] === 'deliveries' && parts.length === 3) {
    const rows = await db.listDeliveries(subscription.id, query);
    return ok(200, { items: rows, nextCursor: null });
  }

  if (method === 'GET' && parts[2] === 'deliveries' && parts.length === 4) {
    const delivery = await db.getDelivery(subscription.id, parts[3]);
    if (!delivery) return error(404, 'NOT_FOUND', 'Delivery not found');
    return ok(200, delivery);
  }

  return error(404, 'NOT_FOUND', 'Route not found');
}

export function revealSecretRecords(secretRows, env = process.env) {
  const signingKey = env.WEBHOOK_SIGNING_KEY ?? 'development-signing-key';
  return secretRows.map((row) => ({ ...row, secret: decryptSecret(row.secret_cipher, row.secret_iv, signingKey) }));
}
