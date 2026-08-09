// Falcone control-plane request-body parsing (kind deploy).
//
// The HTTP request handler (server.mjs) reads the raw bytes of a request, then —
// for a JSON content-type — decides what the dispatched handler receives as its
// `body`. That decision is captured here as a single pure function so it is:
//   1) exercised verbatim by the server (no behavioural drift between code & test),
//   2) unit-testable without booting the server or a database (the established
//      pattern for the kind control-plane, cf. jwt-verify.mjs).
//
// The contract every downstream handler relies on is that `body` is a PLAIN
// OBJECT (handlers dereference `body.displayName`, `body.name`, `body.roles`, …).
// A request body that parses to a non-object JSON value — `null`, an array, or a
// scalar (`false`, `42`, `"x"`) — would make those handlers throw a TypeError
// that surfaces as an opaque 500 (CONTROL_PLANE_ERROR). That is a malformed
// CLIENT request and MUST be a clean, structured 400 — consistent with how an
// empty object `{}` (400 VALIDATION_ERROR from the handler) and unparseable bytes
// `{bad` (400 INVALID_JSON) are already handled. See GitHub issue #666.

/**
 * Should a request body be PARSED as JSON? An absent content-type counts, for backward
 * compatibility with clients that post JSON without declaring it.
 *
 * This is deliberately NOT the same question as "did the client declare a JSON envelope?" — see
 * `declaresJsonBody` in storage-handlers.mjs, which is defined in terms of this so the one
 * intentional difference (the absent-content-type case) is a single explicit clause rather than two
 * hand-synchronised lists. The predicate lives here, next to `normalizeJsonBody`, for the reason
 * this module exists: one definition, exercised verbatim by the server and by tests.
 *
 * @param {string|undefined|null} contentType raw request Content-Type header
 * @returns {boolean}
 */
export function isJsonBody(contentType) {
  const value = String(contentType ?? '').toLowerCase();
  return value.includes('application/json') || value.includes('+json') || value === '';
}

/**
 * Decide the dispatched body for a JSON-content-type request from its raw bytes.
 *
 * Returns a discriminated result the caller maps directly to a response:
 *   { ok: true,  body }                 — parsed to a plain object (or {} for an empty body)
 *   { ok: false, statusCode, error }    — a 400 with a structured { code, message }
 *
 * Only the JSON path goes through here; a binary/opaque (non-JSON content-type)
 * body is handled by the caller and never reaches this function.
 *
 * @param {Buffer|string} rawBody raw request bytes (or the decoded string)
 * @returns {{ok:true, body:object} | {ok:false, statusCode:400, error:{code:string, message:string}}}
 */
export function normalizeJsonBody(rawBody) {
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
  // An empty body is the documented "no payload" case: the handler runs with {}.
  if (text.length === 0) return { ok: true, body: {} };

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, statusCode: 400, error: { code: 'INVALID_JSON', message: 'Body is not valid JSON' } };
  }

  // The body must be a JSON object. `null` (typeof 'object'), arrays, and scalars
  // are rejected here as a structured 400 BEFORE handler dispatch — uniformly
  // across every mutating route and both dispatch paths (local handlers and the
  // /repo action loader) — so a non-object body can never reach a handler and
  // throw an opaque 500. Reuses VALIDATION_ERROR for consistency with the empty
  // object `{}` case (issue #666); no new error code is introduced.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, statusCode: 400, error: { code: 'VALIDATION_ERROR', message: 'Request body must be a JSON object' } };
  }

  return { ok: true, body: parsed };
}
