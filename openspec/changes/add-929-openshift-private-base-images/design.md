# Design

## Cross-repository boundary

`gntik-ai/falcone#929` (this change) owns the ARG-parameterized Dockerfile seams, the
`service-catalog.json` base-image metadata and its validator, black-box regression coverage, and the
disconnected operator documentation. The companion chart capability
[`gntik-ai/falcone-charts#6`](https://github.com/gntik-ai/falcone-charts/issues/6) owns the
`BuildConfig`/`ImageStream` rendering and the `global.openshiftBuild.*` base-image values that map to
Docker-strategy build args. `#6` is still open, so the documentation states the coordinated
dependency truthfully and does not claim the chart keys are already in a released chart.

## Build-arg design

Each of the six released Dockerfiles declares a single global `ARG NODE_BASE_IMAGE=<current base>`
before its first `FROM`, and every `FROM` interpolates `${NODE_BASE_IMAGE}`. A global ARG (declared
before the first `FROM`) is the only ARG form Docker makes available to `FROM` instructions, and it
reaches **all** `FROM` instructions in the file — including the second stage of the multi-stage
`web-console` and `workflow-worker` Dockerfiles, which `dockerStrategy.from` cannot rewrite.

Multi-stage services use one shared arg rather than per-stage args on purpose: `web-console`'s
builder and runtime stages are both `node:22-alpine`, and `workflow-worker`'s build and runtime
stages must both be `node:22-slim` because `@temporalio/core-bridge` ships a glibc native binary that
Alpine's musl cannot load. A single arg parameterizes every `FROM` while structurally guaranteeing
the stages cannot drift to incompatible bases. The defaults are the exact pre-change strings, so a
connected `docker build`/`release-images.yml` run with no `--build-arg` produces byte-identical
bases.

## Catalog as the source of truth

`service-catalog.json` records `baseImageArgs: [{ name, default }]` per released service so the chart
can derive its base-image build-arg names/values and the docs can list exactly which images must
exist in Harbor. `scripts/lib/service-catalog.mjs` parses each released Dockerfile for its global
`ARG NAME=default` declarations and `FROM` references and fails validation when: a `FROM` is a
literal, un-parameterized base; a `FROM` interpolates an arg with no declared default; the catalog
omits a released service's metadata; the catalog and Dockerfile arg names disagree; or a recorded
default drifts from the Dockerfile `ARG` default. This runs inside
`collectServiceCatalogViolations`, so `pnpm validate:service-catalog` (and the CI `lint` job) enforce
it, and the existing `tests/unit/repository-layout.test.mjs` zero-violations assertion covers it.

## Disconnected build inputs

Two build inputs must resolve without the public internet, and only one is solved by the base-image
args:

- **Base layers** — solved here: override `NODE_BASE_IMAGE` to the Harbor copy of `node:22-alpine` /
  `node:22-slim`.
- **Build-time dependency fetches** — `web-console` and `workflow-worker` run `pnpm install` /
  `npm install` during the build. These need a reachable package registry. The docs require a local
  npm/package-registry mirror (or a vendored offline pnpm store) as an explicit prerequisite; it is
  not something the Dockerfile arg or the chart can supply.

## No wire/API impact

This change alters container packaging and documentation only. It does not touch any HTTP endpoint,
request/response shape, status code, error schema, auth claim, real-time event, or the OpenAPI
contract, and it generates no client/SDK. There is therefore no frontend, backend, or generated-code
surface to keep in sync; the OpenShift build path is invisible to the running application and its
console. The catalog `baseImageArgs` field is internal build metadata consumed by the repo validator
and (in future) the chart, not by any runtime API.

## Failure modes and rollback

A recorded catalog default can drift from the Dockerfile; the validator is the deterministic guard
and CI runs it. Documentation can drift from the final chart values because the chart lands
separately; this is mitigated by writing the chart-value reference against the merged
`falcone-charts#6` design and marking the dependency explicitly. Rollback is safe: the args default
to today's bases, so reverting them changes nothing for connected builds, and removing the docs
section affects no behavior.
