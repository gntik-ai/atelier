export function computeNextDelay(attemptNum, { baseMs, maxMs, random = Math.random } = {}) {
  if (attemptNum <= 0) return null;
  const exponential = Math.min(maxMs, baseMs * (2 ** (attemptNum - 1)));
  const jitter = Math.floor(exponential * 0.2 * random());
  return Math.min(maxMs, exponential + jitter);
}

export function hasRetriesRemaining(attemptCount, maxAttempts) {
  return attemptCount < maxAttempts;
}

export function computeNextAttemptAt(attemptNum, config) {
  const delay = computeNextDelay(attemptNum, config);
  if (delay == null) return null;
  return new Date(Date.now() + delay).toISOString();
}

export function buildRetryPolicy(env = process.env) {
  return {
    baseMs: Number(env.WEBHOOK_BASE_BACKOFF_MS ?? 1000),
    maxMs: Number(env.WEBHOOK_MAX_BACKOFF_MS ?? 300000),
    maxAttempts: Number(env.WEBHOOK_MAX_RETRY_ATTEMPTS ?? 5)
  };
}
