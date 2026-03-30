function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function poll(assertFn, opts = {}) {
  const {
    maxWaitMs = 1_000,
    intervalMs = 100,
    backoffFactor = 1.5
  } = opts;

  if (typeof assertFn !== 'function') {
    throw new TypeError('poll requires assertFn to be a function');
  }

  const startedAt = Date.now();
  const maxIntervalMs = Math.max(1, Math.floor(maxWaitMs / 2));
  let currentIntervalMs = Math.max(1, intervalMs);
  let lastError;

  while (Date.now() - startedAt <= maxWaitMs) {
    try {
      await assertFn();
      return;
    } catch (error) {
      lastError = error;
    }

    const elapsedMs = Date.now() - startedAt;
    const remainingMs = maxWaitMs - elapsedMs;
    if (remainingMs <= 0) {
      break;
    }

    const waitMs = Math.min(currentIntervalMs, maxIntervalMs, remainingMs);
    await sleep(waitMs);
    currentIntervalMs = Math.min(Math.ceil(currentIntervalMs * backoffFactor), maxIntervalMs);
  }

  const elapsedMs = Date.now() - startedAt;
  const suffix = lastError ? ` Last assertion error: ${lastError.message}` : '';
  throw new Error(`poll timed out after ${elapsedMs}ms.${suffix}`);
}

export default poll;
