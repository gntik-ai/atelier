/**
 * Build action parameters from untrusted request inputs and trusted server context.
 *
 * Route defaults, flattened query/body values, and matched path parameters retain
 * their existing precedence. Server-owned transport and identity fields are
 * assigned last so a request cannot replace verified identity or request metadata.
 */
export function buildActionParams({
  route,
  method,
  path,
  query,
  body,
  matchedParams,
  owHeaders
}) {
  return {
    ...(route.defaults ?? {}),
    ...(route.mergeQueryIntoParams ? query : {}),
    ...(route.mergeBodyIntoParams && body && typeof body === 'object' ? body : {}),
    ...(matchedParams ?? {}),
    __ow_headers: owHeaders,
    __ow_path: path,
    __ow_method: method,
    method,
    path,
    query,
    body
  };
}
