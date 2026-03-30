export const VALID_TRANSITIONS = Object.freeze({
  pending: Object.freeze(['running', 'cancelled']),
  running: Object.freeze(['completed', 'failed', 'timed_out', 'cancelling']),
  cancelling: Object.freeze(['cancelled', 'failed']),
  completed: Object.freeze([]),
  failed: Object.freeze([]),
  timed_out: Object.freeze([]),
  cancelled: Object.freeze([])
});

export const TERMINAL_STATES = Object.freeze(new Set(['completed', 'failed', 'timed_out', 'cancelled']));
export const CANCELLABLE_STATES = Object.freeze(new Set(['pending', 'running']));

export function isTerminal(status) {
  return TERMINAL_STATES.has(status);
}

export function isCancellableState(status) {
  return CANCELLABLE_STATES.has(status);
}

export function validateTransition(current, next) {
  const allowed = VALID_TRANSITIONS[current] ?? [];

  if (!allowed.includes(next)) {
    throw Object.assign(
      new Error(`Invalid transition: ${current} → ${next}. Allowed: [${allowed.join(', ') || 'none'}]`),
      { code: 'INVALID_TRANSITION', current, next }
    );
  }
}
