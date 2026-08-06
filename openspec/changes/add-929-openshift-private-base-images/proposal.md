# Proposal: OpenShift private base images for disconnected source builds

## Why

The documentation change `add-922-openshift-build-from-source` documents an OpenShift
build-from-source mode, and the companion chart capability
[`gntik-ai/falcone-charts#6`](https://github.com/gntik-ai/falcone-charts/issues/6) will render the
`BuildConfig`/`ImageStream` objects that drive it. Both assume the released service images can be
built with their **base images pulled from a private registry** (Harbor) on a fully disconnected
cluster that reaches no external registry or code host.

Today they cannot. The six released services' Dockerfiles hardcode Docker Hub bases — five use
`FROM node:22-alpine` and `workflow-worker` is multi-stage with `FROM node:22-slim` for both its
build and runtime stages. Those implicit `docker.io/library/node` references are unresolvable in a
disconnected cluster, and OpenShift's `dockerStrategy.from` can only replace the *final* `FROM`, so
multi-stage Dockerfiles need ARG-parameterized bases. `service-catalog.json` also does not record
the base-image build args, so the chart cannot derive its base-image values and operators cannot
know which images must exist in Harbor.

## What changes

- Every `FROM` stage in the six `release: true` services' Dockerfiles (`control-plane`,
  `control-plane-executor`, `web-console`, `workflow-worker`, `mcp-runtime`, `fn-runtime`) becomes
  overridable through a documented `NODE_BASE_IMAGE` build arg whose default preserves the current
  base (`node:22-alpine`, or `node:22-slim` for `workflow-worker`). The multi-stage `web-console`
  and `workflow-worker` Dockerfiles parameterize every `FROM`. Connected builds and
  `release-images.yml` are unchanged because no override is supplied.
- `service-catalog.json` records each released service's `baseImageArgs` (name + default), and
  `scripts/lib/service-catalog.mjs` is extended so any catalog↔Dockerfile base-image drift — an
  un-parameterized literal `FROM`, missing catalog metadata, or a recorded default that no longer
  matches the Dockerfile `ARG` default — fails validation deterministically.
- `docs-site/operations/openshift-install.md` gains a fully-disconnected source-build extension:
  Harbor copies of the exact Node alpine/slim bases with `skopeo copy` examples, a local package
  registry mirror (or offline pnpm store) for build-time dependency fetches, the base-image override
  build args, and troubleshooting for base pulls, dependency fetches, webhook `403/401`, and Harbor
  CA/trust. Its overlays table lists the mode.
- `docs-site/operations/helm-configuration.md` documents the companion `global.openshiftBuild.*`
  base-image / `buildArgs` / `env` keys, truthfully scoped to the coordinated (still-open,
  unreleased) chart capability `gntik-ai/falcone-charts#6`.

## Non-goals

- No change to the default base images or connected build behavior — the args default to today's
  bases.
- No chart rendering changes here — `BuildConfig`/`ImageStream` objects and the base-image values
  belong to `gntik-ai/falcone-charts#6`.
- No automated pipeline that mirrors base images into Harbor — the docs show the manual `skopeo`
  copy.
- No API, UI, SDK, or OpenAPI changes — this is deployment packaging and documentation only.

## Impact and rollback

Files touched: `apps/<service>/Dockerfile` (6), `service-catalog.json`,
`scripts/lib/service-catalog.mjs`, black-box tests, and the two operator documents; plus this
`deployment-packaging` delta. Rollback is safe: the build args default to today's bases, so
reverting them changes nothing for connected builds and `release-images.yml`, and removing the docs
section affects no behavior. The base-image override path is inert until the companion chart
`gntik-ai/falcone-charts#6` is released and an operator explicitly enables it.
