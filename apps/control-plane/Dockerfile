# Control-plane runtime image for the kind deploy.
# BUILD CONTEXT = repo root (so it can COPY the backend action modules):
#   docker build -f apps/control-plane/Dockerfile -t <ref> .
#
# The server (server.mjs) validates the Keycloak JWT and dispatches /v1/* to the
# repo's real action modules under /repo. Bare imports inside those modules
# (e.g. `pg`) resolve via the /node_modules symlink -> /app/node_modules
# (Node's ESM resolver walks up to the filesystem root from /repo).
FROM node:22-alpine
WORKDIR /app

# Server deps (pg for the DI Pool; JWT/JWKS verification is dependency-free via node:crypto).
COPY apps/control-plane/package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
  && ln -sfn /app/node_modules /node_modules

# Server source + domain-B modules + the verified runtime route table.
COPY apps/control-plane/server.mjs apps/control-plane/routes.mjs \
     apps/control-plane/jwt-verify.mjs apps/control-plane/sa-revocation.mjs \
     apps/control-plane/kc-admin.mjs apps/control-plane/tenant-store.mjs \
     apps/control-plane/b-handlers.mjs apps/control-plane/auth-handlers.mjs \
     apps/control-plane/saga.mjs apps/control-plane/dataplane.mjs \
     apps/control-plane/schema-retry.mjs apps/control-plane/tenant-scope.mjs \
     apps/control-plane/governance-schema.mjs apps/control-plane/workspace-quota.mjs \
     apps/control-plane/metrics-handlers.mjs apps/control-plane/metrics-registry.mjs \
     apps/control-plane/request-metric-scope.mjs \
     apps/control-plane/storage-handlers.mjs apps/control-plane/seaweedfs-identity.mjs \
     apps/control-plane/storage-quota.mjs \
     apps/control-plane/mongo-handlers.mjs apps/control-plane/pg-handlers.mjs \
     apps/control-plane/kafka-handlers.mjs \
     apps/control-plane/fn-handlers.mjs apps/control-plane/function-executor.mjs \
     apps/control-plane/application-handlers.mjs \
     apps/control-plane/vault-secrets.mjs \
     apps/control-plane/realtime-handlers.mjs \
     apps/control-plane/webhook-handlers.mjs apps/control-plane/webhook-db.mjs \
     apps/control-plane/webhook-schema.mjs \
     apps/control-plane/audit-store.mjs apps/control-plane/audit-writer.mjs \
     apps/control-plane/audit-hash.mjs \
     apps/control-plane/transport-security.mjs \
     apps/control-plane/request-body.mjs \
     apps/control-plane/tenant-config-export.mjs \
     apps/control-plane/route-map.runtime.json ./

# Backend action modules consumed at runtime (resolved under /repo). Copy the
# services whose actions the route table dispatches to, plus internal-contracts
# (shared) and apps/control-plane-executor (IAM/console modules). Add more dirs as
# families are wired.
COPY packages/provisioning-orchestrator /repo/packages/provisioning-orchestrator
COPY packages/internal-contracts        /repo/packages/internal-contracts
COPY packages/scheduling-engine         /repo/packages/scheduling-engine
COPY packages/webhook-engine            /repo/packages/webhook-engine
# workspace-docs-service supplies migration 087 in the boot schema/recovery set
# (governance-schema.mjs GOVERNANCE_MIGRATIONS). Without this dir the CP boot
# ENOENTs on 087-workspace-doc-notes.sql, permanently fails schema/recovery and
# exits (server.mjs) -> CrashLoopBackOff on any build after v0.6.3.
COPY packages/workspace-docs-service    /repo/packages/workspace-docs-service
COPY apps/control-plane-executor                 /repo/apps/control-plane-executor

# Fail the BUILD if the route map references a handler module the image did not COPY
# (fix-scheduling-handler-dockerfile): `/v1/scheduling/*` dispatched to
# /repo/packages/scheduling-engine/... which was never COPY'd, so every scheduling
# request 500'd with ERR_MODULE_NOT_FOUND at runtime. This static check turns a
# missing COPY into a build failure instead of a runtime 500.
RUN node -e "const fs=require('fs');const list=JSON.parse(fs.readFileSync('./route-map.runtime.json','utf8'));const mods=[...new Set(list.filter(r=>typeof r.module==='string').map(r=>r.module))];const miss=mods.filter(p=>!fs.existsSync(p));if(miss.length){console.error('[build] route map references missing handler modules:\n  '+miss.join('\n  '));process.exit(1)}console.log('[build] all '+mods.length+' route handler modules resolve')"

ENV NODE_ENV=production
USER 1000
EXPOSE 8080
CMD ["node", "server.mjs"]
