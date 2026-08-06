# Release runtime image for the Falcone web-console SPA.
#
# The SPA bundle (apps/web-console/dist) is built in CI with `vite build` BEFORE this image is
# built (see .github/workflows/release-images.yml). The repo's `build` script is `tsc -b && vite
# build`; the `tsc -b` type-check has a pre-existing error baseline that does NOT affect the
# emitted bundle, so the release builds the deployable artifact with `vite build` directly.
#
# Runtime is the dependency-free Node static server (apps/web-console/static-server.mjs):
# serves the bundle on :3000, reverse-proxies same-origin /v1/* to the gateway (GATEWAY_UPSTREAM,
# default falcone-apisix:9080 — the chart overrides it), and exposes /healthz. Chosen over nginx
# because the platform's `restricted` security profile enforces runAsNonRoot + readOnlyRootFilesystem:
# this server makes ZERO filesystem writes and runs as a NUMERIC non-root user (1000), which nginx
# (named user + writes to cache/pid/conf) cannot satisfy. Build context = repo root:
#   pnpm --filter @in-falcone/web-console exec vite build
#   docker build -f apps/web-console/Dockerfile -t in-falcone-web-console:<tag> .
FROM node:22-alpine AS builder
WORKDIR /src
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm --filter @in-falcone/web-console exec vite build

FROM node:22-alpine
WORKDIR /app

# Zero-dependency static server + the freshly built SPA bundle.
COPY apps/web-console/static-server.mjs ./static-server.mjs
COPY --from=builder /src/apps/web-console/dist ./dist

ENV NODE_ENV=production
# Numeric non-root user -> passes runAsNonRoot verification under the restricted profile.
USER 1000
EXPOSE 3000
CMD ["node", "static-server.mjs"]
