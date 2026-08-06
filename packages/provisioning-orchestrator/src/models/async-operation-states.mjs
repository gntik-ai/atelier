import {
  STATUS_TRANSITIONS,
  CANCELLABLE_STATUS_SET,
  TERMINAL_STATUS_SET
} from '../generated/async-operation-status-vocabulary.mjs';

export const VALID_TRANSITIONS = STATUS_TRANSITIONS;
export const TERMINAL_STATES = TERMINAL_STATUS_SET;
export const CANCELLABLE_STATES = CANCELLABLE_STATUS_SET;

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
