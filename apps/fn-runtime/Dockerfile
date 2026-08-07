# Falcone nodejs function runtime (one image; the function source is injected per
# Knative Service revision via the FN_SRC env). OpenShift-friendly: numeric
# non-root user, no fixed uid assumptions beyond runAsNonRoot.
#
# Base image is overridable for disconnected / private-registry builds (issue #929):
# pass `--build-arg NODE_BASE_IMAGE=<registry>/library/node:22-alpine` (e.g. a Harbor
# mirror). The default preserves the current Docker Hub base, so connected builds and
# release-images.yml are unchanged.
ARG NODE_BASE_IMAGE=node:22-alpine
FROM ${NODE_BASE_IMAGE}
WORKDIR /app
COPY apps/fn-runtime/server.mjs ./
ENV NODE_ENV=production PORT=8080
USER 1000
EXPOSE 8080
CMD ["node", "server.mjs"]
