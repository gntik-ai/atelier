import { FORBIDDEN_FIELDS, hasForbiddenField } from './event-schema.mjs';

const forbiddenMatcher = new RegExp(`^(${FORBIDDEN_FIELDS.join('|')})$`, 'i');

export function sanitize(rawVaultLogEntry) {
  const cleaned = stripForbidden(rawVaultLogEntry);
  if (hasForbiddenField(cleaned)) {
    throw new Error('Forbidden field survived sanitization');
  }
  return cleaned;
}

function stripForbidden(value) {
  if (Array.isArray(value)) {
    return value.map(stripForbidden);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !forbiddenMatcher.test(key))
        .map(([key, nested]) => [key, stripForbidden(nested)])
    );
  }
  return value;
}
