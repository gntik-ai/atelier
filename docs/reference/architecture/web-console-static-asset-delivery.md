# Web console static asset delivery

This reference is for platform operators (P3), release engineers (P18), and documentation
maintainers (P17) who need to verify the console's static-delivery and same-origin API boundary.

Falcone serves the built web-console SPA through the co-located release runtime under
`apps/web-console`:

- `apps/web-console/Dockerfile` is the release Dockerfile for `in-falcone-web-console`.
- `apps/web-console/static-server.mjs` is the restricted-profile Node server used by the release
  image and local compatibility images. Both `apps/web-console/Dockerfile` and
  `deploy/kind/web-console/Dockerfile` copy it and run it as their single Node command. It also
  proxies same-origin `/v1/*` requests to `GATEWAY_UPSTREAM` before the SPA fallback.
- `apps/web-console/nginx.conf` and `deploy/kind/web-console/nginx.conf` are legacy compatibility
  configs only; they are not the release image runtime.

## Request routing and malformed static pathnames

The shared Node server classifies exact `/healthz` and raw `/v1` or `/v1/*` targets before static
pathname processing. `/healthz` keeps its `200` response with body `ok`. Raw API targets—including
`/v1/%ZZ`—are forwarded unchanged to `GATEWAY_UPSTREAM`; the gateway remains responsible for API
meaning, authentication, authorization, and tenant isolation.

For every remaining request, the server separates the pathname from its query before decoding the
pathname. An invalid or incomplete percent escape, such as `/%ZZ` or `/%`, or percent-encoded bytes
that are not valid UTF-8 receive this complete response before any static file read or SPA
fallback:

```http
HTTP/1.1 400 Bad Request
Content-Type: text/plain; charset=utf-8

Bad Request
```

The response is fixed and does not reflect the request target or expose filesystem paths, static
or SPA content, exception details, environment values, credentials, or tenant/workspace data. The
decode failure is contained to that request: repeated malformed requests do not terminate or
restart the Node process, close its listener, or make `/healthz`, static assets, SPA routes, or the
same-origin API proxy unavailable.

Malformed percent syntax in a query does not reject an otherwise valid static or SPA pathname.
Valid percent-encoded pathnames continue through the existing asset or SPA-fallback behavior,
including MIME type, compression, cache, and browser security headers.

## Header policy

The web console bundle is emitted with content-hashed files under `/assets/`. Those files are
immutable for a given build, so every static-serving path sends:

```http
Cache-Control: public, max-age=31536000, immutable
```

for `/assets/*` responses.

`index.html` is different. It is the SPA boot document and can change whenever a new build points at
new hashed assets. Every static-serving path sends:

```http
Cache-Control: no-store
```

for `index.html`. The Node static servers also apply the same `no-store` policy to SPA fallback
responses that return `index.html` for client-side routes.

The Node static server sends the baseline browser security headers for the console shell and assets:

```http
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; form-action 'self'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
```

The CSP is the defense-in-depth boundary for the current console session model: the auth API still
returns the console `tokenSet`, and the frontend still stores it in session storage for bearer
requests. To keep arbitrary page script from becoming an easy full-session exfiltration path, static
serving constrains script execution to same-origin bundle files, omits `unsafe-inline` and
`unsafe-eval` from `script-src`, disables plugin/object execution, and denies all framing with both
`frame-ancestors 'none'` and `X-Frame-Options: DENY`. `style-src 'unsafe-inline'` is intentionally
limited to styles because several existing React components use inline style attributes.

The legacy nginx configs repeat these headers in static locations because a `location` block with its
own `add_header` does not inherit headers from the parent server block. The release Node static
server applies the headers directly and leaves proxied `/v1/` API response headers unchanged.

## Icon asset policy

The SVG-capable favicon declared by `apps/web-console/index.html` is part of the console boot path.
It must remain a lightweight true vector SVG, with a target budget of roughly 10 KB or less. Do not
embed raster icon artwork as `data:image/*;base64` inside `favicon.svg`; keep raster fallbacks such
as `favicon.png` as separate small files.

## Compression policy

Compressible bundle assets are JavaScript, CSS, JSON, and SVG. The Node static server uses only Node
built-ins and does not write precompressed files to disk. It inspects `Accept-Encoding` and:

- return Brotli (`content-encoding: br`) when the client accepts `br`;
- otherwise return gzip (`content-encoding: gzip`) when the client accepts `gzip`;
- leave non-compressible assets such as PNG, ICO, and WOFF2 uncompressed.

The Node static server sets `Vary: Accept-Encoding` on compressible asset responses so caches do not
serve a compressed variant to a client that did not request it.

## Test and runtime overrides

The supported image runtime is Node 22, as pinned by both Dockerfiles. Reproducing behavior under a
newer local Node version does not widen that supported runtime scope. The Node static server keeps
its container defaults:

- `WEB_CONSOLE_STATIC_ROOT=/app/dist`
- `PORT=3000`

Focused tests may override those variables to serve a temporary `dist` directory on an ephemeral
port. The overrides are test hooks only; they do not change the container defaults or require extra
runtime dependencies.

Run the deterministic local process-boundary suite with:

```bash
node --test tests/unit/web-console-static-server.test.mjs
```

The suite uses a temporary static root, `PORT=0`, and an ephemeral local mock gateway. It verifies
malformed-path `400` responses, same-PID recovery, valid encoded/static/SPA behavior, raw `/v1`
proxy fidelity, and the existing `GATEWAY_UNREACHABLE` `502` response without Docker, Kubernetes,
fixed ports, repository fixture writes, or external network access.
