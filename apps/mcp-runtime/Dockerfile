# Falcone MCP runtime. Build from the repo root:
#   docker build -f apps/mcp-runtime/Dockerfile -t in-falcone-mcp-runtime:0.3.0 .
#
# Base image is overridable for disconnected / private-registry builds (issue #929):
# pass `--build-arg NODE_BASE_IMAGE=<registry>/library/node:22-alpine` (e.g. a Harbor
# mirror). The default preserves the current Docker Hub base, so connected builds and
# release-images.yml are unchanged.
ARG NODE_BASE_IMAGE=node:22-alpine
FROM ${NODE_BASE_IMAGE}

WORKDIR /app/apps/mcp-runtime

COPY apps/mcp-runtime/server.mjs /app/apps/mcp-runtime/server.mjs
COPY apps/control-plane-executor/src/mcp-authoring.mjs /app/apps/control-plane-executor/src/mcp-authoring.mjs
COPY apps/control-plane-executor/src/mcp-official-catalog.mjs /app/apps/control-plane-executor/src/mcp-official-catalog.mjs
COPY apps/control-plane-executor/src/mcp-official-server.mjs /app/apps/control-plane-executor/src/mcp-official-server.mjs

ENV NODE_ENV=production \
    PORT=8080

EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
