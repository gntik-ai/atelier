import { WORKSPACE_DOCS_NOTE_MAX_LENGTH } from './config.mjs'

const TAGS_REGEX = /<[^>]+>/g
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g

export function sanitise(content) {
  const decoded = String(content ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

  const cleaned = decoded.replace(TAGS_REGEX, '').replace(CONTROL_CHARS_REGEX, '').trim()

  if (!cleaned || cleaned.length > WORKSPACE_DOCS_NOTE_MAX_LENGTH) {
    const error = new Error('Invalid note content')
    error.code = 'INVALID_NOTE_CONTENT'
    throw error
  }

  return cleaned
}
