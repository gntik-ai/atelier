# Temporal DSL interpreter worker (change: add-flows-dsl-interpreter-worker / #359).
#
# Built from the REPO ROOT so workspace deps resolve, consistent with
# apps/control-plane-executor/Dockerfile:
#   docker build -f apps/workflow-worker/Dockerfile -t in-falcone-workflow-worker:0.1.0 .
#
# Two stages: (1) compile TypeScript → dist/ (CommonJS) with dev deps, then (2) a slim
# runtime image with only production deps and the compiled dist/, running as USER node.
# @temporalio/core-bridge ships a glibc native binary; Alpine (musl) cannot load it.
# Use node:22-slim (Debian Bookworm slim) which provides glibc. Both stages must match.
#
# Both FROM stages must be overridable for disconnected / private-registry builds, and
# OpenShift `dockerStrategy.from` only rewrites the FINAL FROM. A single `NODE_BASE_IMAGE`
# build arg parameterizes both stages so they can never drift to incompatible bases (the
# glibc requirement above); pass `--build-arg NODE_BASE_IMAGE=<registry>/library/node:22-slim`
# (e.g. a Harbor mirror) to pull base layers only from that registry (issue #929). The
# default preserves the current Docker Hub base, so connected builds and release-images.yml
# are unchanged.
ARG NODE_BASE_IMAGE=node:22-slim
FROM ${NODE_BASE_IMAGE} AS build
WORKDIR /app/apps/workflow-worker

# Install ALL deps (incl. typescript) for the tsc compile.
COPY apps/workflow-worker/package.json ./package.json
RUN npm install --no-package-lock

# Compile.
COPY apps/workflow-worker/tsconfig.json ./tsconfig.json
COPY apps/workflow-worker/src ./src
COPY apps/workflow-worker/scripts ./scripts
RUN npm run build

# ---- runtime ----
FROM ${NODE_BASE_IMAGE} AS runtime
# Install the production deps at the /app ROOT (not under apps/workflow-worker) so
# `pg` resolves from BOTH the worker dist (/app/apps/workflow-worker/dist) AND the
# copied apps/control-plane-executor runtime modules (/app/apps/control-plane-executor/src/runtime) — the
# latter `import 'pg'` and the ESM resolver only walks up to a node_modules in an ANCESTOR
# dir. Worker package.json has no "type", so dist/worker.js stays CJS. (#563 wiring.)
WORKDIR /app
COPY apps/workflow-worker/package.json ./package.json
RUN npm install --omit=dev --no-package-lock
WORKDIR /app/apps/workflow-worker

# Compiled output.
COPY --from=build /app/apps/workflow-worker/dist ./dist

# The ssrf.mjs activity imports isBlockedIp from packages/webhook-engine/src/webhook-subscription.mjs
# via a relative path (../../../../packages/webhook-engine/src/...). The entire webhook-engine/src/ must live at
# the same path relative to the dist/ directory as it does in the repo workspace, because
# webhook-subscription.mjs itself imports from event-catalogue.mjs in the same directory.
COPY packages/webhook-engine/src /app/packages/webhook-engine/src

# worker-deps.mjs::wireActivityDeps (fix-flows-worker-db-activity-wiring / #563, extended
# by the llm.complete activity #640 and the BYOK confinement #659) dynamically imports a
# set of apps/control-plane-executor runtime modules + the internal-contracts transport-security
# helper at boot. Every one of those modules must be reachable relative to dist/worker.js
# (which dynamic-imports dist/worker-deps.mjs, whose ../../../... specifiers resolve from
# /app/apps/workflow-worker/dist → repo root maps to /app):
#   dist/worker-deps.mjs → ../../../apps/control-plane-executor/src/runtime/*.mjs              ✓
#     postgres-data-executor.mjs                                                       (data activity)
#     connection-registry.mjs, workspace-dsn-resolver.mjs                             (workspace DSN routing)
#     llm-executor.mjs        (#640 llm.complete activity)                            ← was missing → #660
#     byok-provider-guard.mjs (#659 BYOK secret/SSRF confinement, imported by         ← was missing → #660
#                              llm-executor.mjs and pulled in by worker-deps.mjs)
#   apps/control-plane-executor/src/runtime/postgres-data-executor.mjs imports:
#       ../../../../packages/adapters/src/postgresql-data-api.mjs                      ✓
#   dist/worker-deps.mjs → ../../../packages/internal-contracts/src/
#       transport-security.mjs  (#645 withPostgresSsl)                                 ← was missing → #660
# A missing module here is a runtime ERR_MODULE_NOT_FOUND crash-loop (#660); the
# resolution guard below turns any future omission into a build failure instead.
COPY apps/control-plane-executor/src/runtime/connection-registry.mjs \
     apps/control-plane-executor/src/runtime/postgres-data-executor.mjs \
     apps/control-plane-executor/src/runtime/workspace-dsn-resolver.mjs \
     apps/control-plane-executor/src/runtime/llm-executor.mjs \
     apps/control-plane-executor/src/runtime/byok-provider-guard.mjs \
     apps/control-plane-executor/src/runtime/errors.mjs \
     /app/apps/control-plane-executor/src/runtime/
COPY packages/adapters/src/postgresql-data-api.mjs \
     packages/adapters/src/postgresql-governance-admin.mjs \
     /app/packages/adapters/src/
COPY packages/internal-contracts/src/transport-security.mjs \
     /app/packages/internal-contracts/src/

# Build-time module-completeness guard (#660; mirrors the route-module check in
# apps/control-plane/Dockerfile for fix-scheduling-handler-dockerfile). The COPY
# allow-list above has drifted from worker-deps.mjs::wireActivityDeps three times (#640,
# #645, #659), each time crash-looping the worker at boot with ERR_MODULE_NOT_FOUND.
# This step parses the SHIPPED dist/worker-deps.mjs for every relative `.mjs` specifier it
# dynamicImport()s, resolves each against the dist dir exactly as Node will at runtime, and
# fails the build if any are absent — converting a runtime crash-loop into a build error.
RUN node --input-type=module -e "import { readFileSync, existsSync } from 'node:fs'; import { resolve, dirname } from 'node:path'; const distDir = '/app/apps/workflow-worker/dist'; const src = readFileSync(resolve(distDir, 'worker-deps.mjs'), 'utf8'); const specs = [...src.matchAll(/dynamicImport\(\s*[\x27\x22]([^\x27\x22]+)[\x27\x22]/g)].map((m) => m[1]).filter((s) => s.startsWith('.') && s.endsWith('.mjs')); const missing = specs.filter((s) => !existsSync(resolve(distDir, s))); if (missing.length) { console.error('[worker-image-guard] worker-deps.mjs dynamic-imports modules not copied into the image (#660): ' + missing.join(', ')); process.exit(1); } console.log('[worker-image-guard] OK: ' + specs.length + ' dynamic-imported runtime module(s) present');"

ENV NODE_ENV=production \
    TEMPORAL_ADDRESS=temporal-frontend:7233 \
    TEMPORAL_NAMESPACE=falcone-flows \
    TEMPORAL_TASK_QUEUE=flows-main \
    WORKER_HEALTH_PORT=8080

EXPOSE 8080
USER node
CMD ["node", "dist/worker.js"]
