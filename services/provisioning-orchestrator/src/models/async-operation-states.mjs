export const VALID_TRANSITIONS = Object.freeze({
  pending: Object.freeze(['running']),
  running: Object.freeze(['completed', 'failed']),
  completed: Object.freeze([]),
  failed: Object.freeze([])
});

export const TERMINAL_STATES = Object.freeze(new Set(['completed', 'failed']));

export function isTerminal(status) {
  return TERMINAL_STATES.has(status);
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
