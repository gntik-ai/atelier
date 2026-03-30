const NOTE_MAX_LENGTH_FALLBACK = 4096

function readEnv(name, { required = false, fallback } = {}) {
  const value = process.env[name] ?? fallback
  if (required && (!value || value === '')) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export const WORKSPACE_DOCS_DB_URL = readEnv('WORKSPACE_DOCS_DB_URL', { fallback: '' })
export const KAFKA_BROKERS = readEnv('KAFKA_BROKERS', { fallback: '' })
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
export const INTERNAL_API_BASE_URL = readEnv('INTERNAL_API_BASE_URL', { fallback: '' })
export const WORKSPACE_DOCS_NOTE_MAX_LENGTH = Number.parseInt(
  readEnv('WORKSPACE_DOCS_NOTE_MAX_LENGTH', { fallback: String(NOTE_MAX_LENGTH_FALLBACK) }),
  10
)

if (!Number.isFinite(WORKSPACE_DOCS_NOTE_MAX_LENGTH) || WORKSPACE_DOCS_NOTE_MAX_LENGTH <= 0) {
  throw new Error('WORKSPACE_DOCS_NOTE_MAX_LENGTH must be a positive integer')
}

export function validateRuntimeConfig() {
  return {
    WORKSPACE_DOCS_DB_URL,
    KAFKA_BROKERS,
    INTERNAL_API_BASE_URL,
    WORKSPACE_DOCS_NOTE_MAX_LENGTH
  }
}
