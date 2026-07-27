import { main as dispatchWebhookEvent } from '../../packages/webhook-engine/actions/webhook-dispatcher.mjs';
import { main as runWebhookDelivery } from '../../packages/webhook-engine/actions/webhook-delivery-worker.mjs';
import { main as scheduleWebhookRetry } from '../../packages/webhook-engine/actions/webhook-retry-scheduler.mjs';
import { assertLifecycleVerifiedWebhookKeyContext } from '../../packages/webhook-engine/src/webhook-master-key.mjs';

let configuredKeyContext = null;

function runtimeError(code) {
  return Object.assign(new Error('Webhook runtime is unavailable'), { code });
}

/**
 * Bind the one startup-verified key context to this process. Key bytes remain in
 * this closure and are never copied into delivery messages, Kafka envelopes, or
 * public action parameters.
 */
export function configureWebhookRuntimeKeyContext(keyContext) {
  const verified = assertLifecycleVerifiedWebhookKeyContext(keyContext);
  if (configuredKeyContext && configuredKeyContext !== verified) {
    throw runtimeError('WEBHOOK_KEY_CONTEXT_ALREADY_CONFIGURED');
  }
  configuredKeyContext = verified;
  return verified;
}

export function requireWebhookRuntimeKeyContext() {
  if (!configuredKeyContext) throw runtimeError('WEBHOOK_KEY_CONTEXT_UNAVAILABLE');
  return assertLifecycleVerifiedWebhookKeyContext(configuredKeyContext);
}

function assertDeliveryMessage(message) {
  if (!message || typeof message.deliveryId !== 'string' || message.deliveryId.length === 0) {
    throw runtimeError('WEBHOOK_DELIVERY_MESSAGE_INVALID');
  }
  const keys = Object.keys(message);
  if (keys.some((key) => !['deliveryId', 'scheduledFor'].includes(key))) {
    throw runtimeError('WEBHOOK_DELIVERY_MESSAGE_INVALID');
  }
  return Object.freeze({
    deliveryId: message.deliveryId,
    ...(message.scheduledFor == null ? {} : { scheduledFor: message.scheduledFor }),
  });
}

/**
 * Create the delivery runtime boundary around a lifecycle-verified context.
 * Dispatcher and retry scheduler submit only delivery metadata. This adapter
 * resolves the process-local verified context at execution time and injects it
 * directly into the worker without serializing key bytes or a context object.
 */
export function createWebhookRuntimeAdapter({
  keyContext = requireWebhookRuntimeKeyContext(),
  db,
  kafka = null,
  http,
  resolver,
  dispatcherFactory,
  env = process.env,
} = {}) {
  const verified = assertLifecycleVerifiedWebhookKeyContext(keyContext);
  if (!db) throw runtimeError('WEBHOOK_RUNTIME_DB_REQUIRED');

  let adapter;
  const scheduler = {
    main: scheduleWebhookRetry,
    get invoker() { return adapter; },
  };
  adapter = Object.freeze({
    async invokeWebhookDelivery(message) {
      const delivery = assertDeliveryMessage(message);
      return runWebhookDelivery({
        db,
        kafka,
        scheduler,
        http,
        resolver,
        dispatcherFactory,
        env,
        deliveryId: delivery.deliveryId,
        keyContext: verified,
      });
    },

    async dispatch(event) {
      return dispatchWebhookEvent({ db, invoker: adapter, event, env });
    },
  });
  return adapter;
}
