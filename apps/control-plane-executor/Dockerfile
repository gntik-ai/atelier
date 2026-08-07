# Control-plane executor service (change: add-control-plane-executor).
# Build from the REPO ROOT so the executor's relative import of the adapter plan
# builders (apps/control-plane-executor/src/runtime -> ../../../../packages/adapters/src) resolves:
#   docker build -f apps/control-plane-executor/Dockerfile -t in-falcone-control-plane-executor:0.7.0 .
#
# Base image is overridable for disconnected / private-registry builds (issue #929):
# pass `--build-arg NODE_BASE_IMAGE=<registry>/library/node:22-alpine` (e.g. a Harbor
# mirror). The default preserves the current Docker Hub base, so connected builds and
# release-images.yml are unchanged.
ARG NODE_BASE_IMAGE=node:22-alpine
FROM ${NODE_BASE_IMAGE}

WORKDIR /app

# Install runtime deps at /app/node_modules so they are accessible from ALL paths
# under /app (including packages/internal-contracts, packages/webhook-engine, etc.
# which are copied as sibling directories and may import shared packages).
# Node ESM resolution walks UP from the importing file's directory; placing
# node_modules at /app ensures it is reached regardless of which sub-tree the
# import originates from.
COPY apps/control-plane-executor/package.json /app/package.json
RUN npm install --omit=dev --no-package-lock

# App sources + the adapter plan-builder layer the executor imports. The Mongo data
# adapter loads internal-contracts (JSON read at runtime), so ship that src too.
# The flows-related modules import from:
#   - apps/workflow-worker/src/activities/catalog-names.mjs (task-type names)
#   - packages/audit/src/flow-lifecycle-events.mjs (lifecycle event builder)
#   - packages/webhook-engine/src/ (webhook signing)
#   - packages/workspace-docs-service/ (console workspace docs route)
COPY apps/control-plane-executor/src /app/apps/control-plane-executor/src
COPY apps/control-plane/knative-runtime.mjs /app/apps/control-plane/knative-runtime.mjs
COPY apps/control-plane/runtime-cleanup-repository.mjs /app/apps/control-plane/runtime-cleanup-repository.mjs
COPY packages/adapters/src /app/packages/adapters/src
COPY packages/internal-contracts/src /app/packages/internal-contracts/src
# Realtime executor (add-ferretdb-realtime-cdc-remediation #460) imports the shared logical-
# replication modules (WalReplicationClient/CollectionCatalog/provisionLogicalReplication) from the
# CDC bridge. Node resolves their deps (pg-logical-replication, bson — declared in this image's
# package.json) from /app/node_modules via the upward walk.
COPY packages/mongo-cdc-bridge/src /app/packages/mongo-cdc-bridge/src
COPY apps/workflow-worker/src/activities/catalog-names.mjs /app/apps/workflow-worker/src/activities/catalog-names.mjs
COPY packages/audit/src /app/packages/audit/src
COPY packages/webhook-engine/src /app/packages/webhook-engine/src
COPY packages/workspace-docs-service/actions /app/packages/workspace-docs-service/actions
COPY packages/workspace-docs-service/src /app/packages/workspace-docs-service/src

ENV NODE_ENV=production \
    PORT=8080 \
    KNATIVE_RUNTIME_MODE=disabled \
    KNATIVE_RUNTIME_STATUS_FILE=/var/run/falcone/knative/status.json \
    FUNCTIONS_ENABLED=true

EXPOSE 8080
USER node
WORKDIR /app/apps/control-plane-executor
CMD ["node", "src/runtime/main.mjs"]
