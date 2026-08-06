# Design

## Cross-repository boundary

`gntik-ai/falcone-charts#3` owns the values contract and Kubernetes/OpenShift resources. Falcone
issue `#922` owns the two source-build Dockerfile seams, black-box regression coverage, normative
packaging requirements, and operator documentation. The documentation must describe the rendered
chart rather than duplicate a divergent values design.

## Values propagation and image ownership

The setting is `global.openshiftBuild`, rather than a root `openshiftBuild`, because Helm global
values propagate into the aliased `component-wrapper` subcharts that render service images. When
enabled, the chart uses a stable internal-registry pullspec with the configured ImageStream tag.
Helm owns that desired pullspec and the `image.openshift.io/triggers` annotation; OpenShift's image
trigger controller owns subsequent updates from a stream tag to a concrete image reference. A
later Helm upgrade renders the same stable pullspec and therefore does not fight the controller.

Only `control-plane`, `control-plane-executor`, `web-console`, and `workflow-worker` are Deployment
backed. `fn-runtime` and `mcp-runtime` are configuration values consumed when new function or MCP
pods are created, so existing pods and revisions are intentionally unchanged.

## Build and webhook security

The chart renders six Docker-strategy BuildConfigs from the catalog Dockerfile paths and six
ImageStreams. `ConfigChange` creates the initial builds. GitLab triggers use a Secret reference;
neither values nor rendered manifests contain the Secret bytes. The full webhook URL contains the
secret and is treated as a credential. Cluster policy grants the unauthenticated webhook ingress
identity only `create` on the namespaced `buildconfigs/webhooks` subresource, never general
BuildConfig write access. Private Git credentials live in a same-Project source Secret.

The five smaller source builds use a common `128Mi` request and `1Gi` limit. The Monaco-heavy
web-console production bundle demonstrably exceeds a 1.28 GiB Node heap, so its BuildConfig merges a
`512Mi` request and `3Gi` limit while Vite uses a bounded 1.5 GiB heap. Both resource maps remain
operator-configurable. The defaults total `1152Mi` of requests and `8Gi` of limits when all six
ConfigChange builds run concurrently.

## Source-build Dockerfiles

OpenShift supplies the monorepo root as the Docker build context. `fn-runtime` therefore copies
`apps/fn-runtime/server.mjs`. `web-console` builds its `dist` directory in a pnpm builder stage from
the locked workspace and copies only the resulting static bundle into its numeric-non-root runtime
stage. The final runtime image does not contain the builder dependency tree.

## Failure modes and rollback

Expected operational failures are Git clone/source-Secret errors, Docker build failures, webhook
secret or subresource-RBAC rejection, internal-registry output failures, and an annotation/container
mismatch that prevents rollout. The guide provides a distinct diagnostic for each boundary.
Disabling the mode removes Helm-owned Build API objects and annotations and restores prebuilt-image
rendering. Existing ImageStream-produced images may remain in registry storage according to cluster
retention policy, but no workload continues to reference them through this mode.
