# Falcone MCP runtime. Build from the repo root:
#   docker build -f apps/mcp-runtime/Dockerfile -t in-falcone-mcp-runtime:0.3.0 .
FROM node:22-alpine

WORKDIR /app/apps/mcp-runtime

COPY apps/mcp-runtime/server.mjs /app/apps/mcp-runtime/server.mjs
COPY apps/shared/error-envelope.mjs /app/apps/shared/error-envelope.mjs
COPY apps/control-plane-executor/src/mcp-authoring.mjs /app/apps/control-plane-executor/src/mcp-authoring.mjs
COPY apps/control-plane-executor/src/mcp-official-catalog.mjs /app/apps/control-plane-executor/src/mcp-official-catalog.mjs
COPY apps/control-plane-executor/src/mcp-official-server.mjs /app/apps/control-plane-executor/src/mcp-official-server.mjs

ENV NODE_ENV=production \
    PORT=8080

EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
