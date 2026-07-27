const ADVISORY_LOCK_CLASS = 723661;
const ADVISORY_LOCK_OBJECT = 25;

const WRITE_FENCE_CODE = 'WEBHOOK_KEY_UNAVAILABLE';
const WRITE_FENCE_MESSAGE = 'Webhook key lifecycle is not ready';

export class WebhookKeyWriteFenceError extends Error {
  constructor() {
    super(WRITE_FENCE_MESSAGE);
    this.name = 'WebhookKeyWriteFenceError';
    this.code = WRITE_FENCE_CODE;
  }
}

function writeFenceFailed() {
  throw new WebhookKeyWriteFenceError();
}

/**
 * Every lifecycle repository transaction assumes the fixed NOLOGIN authority
 * transaction-locally before it accesses lifecycle relations. The distinct
 * lifecycle LOGIN has INHERIT FALSE and may SET only this authority, so direct
 * pooled queries remain denied and COMMIT/ROLLBACK restores the session role.
 */
export async function assumeWebhookKeyLifecycleAuthority(client) {
  await client.query('SET LOCAL ROLE falcone_webhook_key_lifecycle');
}

/**
 * Lifecycle mutations take this transaction-scoped exclusive lock before
 * inspecting durable key state or signing-secret rows.
 */
export async function acquireWebhookKeyLifecycleFence(client) {
  // Before schema execution, a separate chart one-shot bootstrap binds only the
  // distinct lifecycle LOGIN principal. The row trigger therefore sees an
  // independently authenticated and authorized effective current_user instead
  // of trusting the advisory-lock shape alone.
  await assumeWebhookKeyLifecycleAuthority(client);
  await client.query(
    'SELECT pg_advisory_xact_lock($1, $2)',
    [ADVISORY_LOCK_CLASS, ADVISORY_LOCK_OBJECT],
  );
}

/**
 * Every ordinary write of encrypted webhook signing-secret material takes the
 * matching shared transaction lock before it asserts the durable serving
 * identity. A lifecycle transaction therefore waits for a writer that already
 * owns the shared lock, while a stale writer waiting behind a completed
 * lifecycle transform fails before it can write source-key ciphertext.
 */
export async function acquireWebhookKeyWriteFence(client, expectedKeyId) {
  if (typeof expectedKeyId !== 'string' || expectedKeyId.length === 0) {
    writeFenceFailed();
  }

  try {
    // The dedicated connection authenticates as a distinct LOGIN principal
    // explicitly bound to this NOLOGIN authority. The trigger evaluates the
    // resulting effective current_user; a caller-controlled GUC, role membership
    // without SET ROLE, or advisory-lock possession is not accepted instead.
    await client.query('SET LOCAL ROLE falcone_webhook_key_writer');
    await client.query(
      'SELECT pg_advisory_xact_lock_shared($1, $2)',
      [ADVISORY_LOCK_CLASS, ADVISORY_LOCK_OBJECT],
    );
    const { rows } = await client.query(
      'SELECT falcone_webhook_key_write_current_id() AS current_key_id',
    );
    if (rows[0]?.current_key_id !== expectedKeyId) {
      writeFenceFailed();
    }
  } catch (caught) {
    if (caught instanceof WebhookKeyWriteFenceError) throw caught;
    writeFenceFailed();
  }
}
