import {
  createRuntimeWebhookKeyContext,
  deriveWebhookKeyId,
  formatCanonicalWebhookKey,
} from '../../packages/webhook-engine/src/webhook-master-key.mjs';

export const TEST_WEBHOOK_KEY_ID = deriveWebhookKeyId('test-namespace', 'test-webhook-key', 'key');
export const TEST_WEBHOOK_KEY_MATERIAL = formatCanonicalWebhookKey(Buffer.alloc(32, 0x5a));
export const TEST_WEBHOOK_KEY_CONTEXT = createRuntimeWebhookKeyContext({
  material: TEST_WEBHOOK_KEY_MATERIAL,
  keyId: TEST_WEBHOOK_KEY_ID,
  mode: 'canonical-v1',
  lifecycleState: {
    lifecycle_state: 'serving',
    current_key_id: TEST_WEBHOOK_KEY_ID,
    current_mode: 'canonical-v1',
  },
});
