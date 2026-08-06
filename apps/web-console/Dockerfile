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
#
# This is a multi-stage build, so both the builder and the runtime stage must be
# overridable for disconnected / private-registry builds (OpenShift `dockerStrategy.from`
# only rewrites the FINAL FROM). A single `NODE_BASE_IMAGE` build arg parameterizes every
# FROM so the two stages always share one base; pass
# `--build-arg NODE_BASE_IMAGE=<registry>/library/node:22-alpine` (e.g. a Harbor mirror)
# to pull base layers only from that registry (issue #929). The default preserves the
# current Docker Hub base, so connected builds and release-images.yml are unchanged.
ARG NODE_BASE_IMAGE=node:22-alpine
FROM ${NODE_BASE_IMAGE} AS builder
WORKDIR /src
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile --filter @in-falcone/web-console...
RUN NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @in-falcone/web-console exec vite build

FROM ${NODE_BASE_IMAGE}
WORKDIR /app

# Zero-dependency static server + the freshly built SPA bundle.
COPY apps/web-console/static-server.mjs ./static-server.mjs
COPY --from=builder /src/apps/web-console/dist ./dist

ENV NODE_ENV=production
# Numeric non-root user -> passes runAsNonRoot verification under the restricted profile.
USER 1000
EXPOSE 3000
CMD ["node", "static-server.mjs"]
