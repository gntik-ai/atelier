# Falcone nodejs function runtime (one image; the function source is injected per
# Knative Service revision via the FN_SRC env). OpenShift-friendly: numeric
# non-root user, no fixed uid assumptions beyond runAsNonRoot.
FROM node:22-alpine
WORKDIR /app
COPY apps/fn-runtime/server.mjs ./
ENV NODE_ENV=production PORT=8080
USER 1000
EXPOSE 8080
CMD ["node", "server.mjs"]
