- [x] Parameterize every `FROM` stage in the six `release: true` Dockerfiles with a
  `NODE_BASE_IMAGE` build arg defaulting to the current base (alpine/slim).
- [x] Record `baseImageArgs` (name + default) for each released service in `service-catalog.json`.
- [x] Extend `scripts/lib/service-catalog.mjs` to fail on catalog↔Dockerfile base-image drift
  (literal FROM, missing metadata, default mismatch).
- [x] Add black-box coverage for every scenario (parameterized FROMs, private-registry override,
  unchanged defaults, catalog metadata, validator drift, release-workflow compatibility) and update
  the `#927` literal-FROM assertions.
- [x] Document the fully-disconnected build-from-source path (Harbor `skopeo` base copies, package
  mirror, base-image override args, troubleshooting) and the overlays table in
  `openshift-install.md`.
- [x] Document the companion `global.openshiftBuild.*` base-image values in `helm-configuration.md`,
  scoped truthfully to `gntik-ai/falcone-charts#6`.
- [ ] Observe the full disconnected OpenShift build/rollout end to end. The authorized OpenShift
  4.21.21 test endpoint (project `cingusoft-dev`) exposes the Build and Image APIs, so the
  repository side of this change is verifiable there with safe `oc`/Build/Image checks (the
  independent checker runs these; no deploy is required from this change). The complete
  chart-driven disconnected rollout remains blocked on two things that are not this change's scope:
  the companion chart `gntik-ai/falcone-charts#6` (still open) must render the
  `BuildConfig`/`ImageStream` objects and the `baseImages`/`env` values, and a disconnected
  GitLab/Harbor/package-registry mirror must be provisioned to hold the source, base images, and
  build-time packages.
