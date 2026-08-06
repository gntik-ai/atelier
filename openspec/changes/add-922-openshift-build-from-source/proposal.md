# Proposal: OpenShift build-from-source documentation

## Why

Falcone's OpenShift guide covers published images and images mirrored to Harbor, but not the chart
`0.4.0` path that builds the six released Falcone services from a Git mirror. Operators otherwise
have no single, testable procedure for creating the Secrets, enabling the values, registering the
GitLab Push webhooks, or proving the Build-to-ImageStream-to-rollout chain.

Live acceptance also showed that the former `web-console` and `fn-runtime` Dockerfiles could not
build from the repository-root context supplied by an OpenShift Docker build. The documented mode
cannot be truthful until those image entry points work from a clean checkout.

## What changes

- Document the OpenShift-only `global.openshiftBuild` contract and all defaults.
- Provide a secret-safe install and GitLab webhook-registration procedure.
- Provide exact verification for the six initial builds, webhook-triggered builds, ImageStreamTags,
  four Deployment rollouts, and the two dynamically launched runtime images.
- Make the `web-console` and `fn-runtime` Dockerfiles self-contained for a clean repository-root
  build context and guard them with black-box tests.
- Coordinate with `gntik-ai/falcone-charts#3` and its implementation PR
  `gntik-ai/falcone-charts#4`, which own the BuildConfig, ImageStream, image-trigger, values-schema,
  and release-notes implementation.

## Non-goals

- OpenShift Builds on vanilla Kubernetes.
- Tekton or another in-cluster CI system.
- Path-filtered monorepo builds; one GitLab push may trigger all six BuildConfigs.
- Changing the default public-image or Harbor installation paths.

## Impact and rollback

The Falcone repository changes two released-image Dockerfiles, their black-box tests, OpenShift
operator documentation, and the `deployment-packaging` specification. The companion chart changes
are gated by `global.openshiftBuild.enabled=false`, so existing releases retain their configured
images. Rollback is a Helm upgrade with the mode disabled followed, if required, by reverting the
documentation and Dockerfile changes.
