# Contributing

Guide for contributing to the In Falcone platform.

## Development Setup

### Prerequisites

- **Node.js** 20+ (ESM modules)
- **pnpm** 10+
- **Docker** (for local infrastructure)
- **Helm** 3.12+ (for chart development)
- **kubectl** (for cluster testing)

### Clone and Install

```bash
git clone https://github.com/gntik-ai/falcone.git
cd falcone
pnpm install
```

### Project Structure

```
falcone/
├── apps/                  # Deployable applications
│   ├── control-plane/     # Platform API (Node.js)
│   └── web-console/       # Management UI (React)
├── services/              # Reusable packages
│   ├── adapters/          # Provider adapters
│   ├── internal-contracts/# Machine-readable schemas
│   └── ...
├── charts/                # Helm charts
│   └── in-falcone/        # Umbrella chart
├── tests/                 # E2E and hardening tests
│   ├── e2e/               # End-to-end tests
│   └── hardening/         # Security hardening tests
├── scripts/               # Validation and generation scripts
└── docs/                  # Internal documentation and ADRs
```

## Conventions

### Code Style

- **ESM modules** — All Node.js code uses `"type": "module"` with `.mjs` extensions
- **No unnecessary dependencies** — Prefer Node.js built-ins (`node:test`, `node:assert`, `node:crypto`)
- **Explicit imports** — No barrel files or implicit re-exports
- **Small increments** — Deliver in focused, reviewable PRs

### File Naming

| Type | Convention | Example |
|------|-----------|---------|
| Source | kebab-case | `keycloak-admin.mjs` |
| Tests | `.test.mjs` suffix | `keycloak-admin.test.mjs` |
| Schemas | kebab-case `.json` | `domain-model.json` |
| ADRs | `NNNN-title.md` | `0001-monorepo-bootstrap.md` |
| Helm values | kebab-case `.yaml` | `platform-kubernetes.yaml` |

### Commit Messages

Follow conventional commits:

```
type(scope): description

feat(control-plane): add workspace deactivation endpoint
fix(adapters): handle Keycloak realm deletion timeout
docs(guides): update quickstart with new auth flow
refactor(orchestrator): extract validation into separate module
test(e2e): add tenant lifecycle smoke test
chore(charts): bump APISIX image to 3.10.1
```

### Branch Naming

```
feature/<issue-number>-short-description
fix/<issue-number>-short-description
docs/<topic>
```

## Validation Scripts

Run validation before submitting a PR:

```bash
# Validate monorepo structure
pnpm run validate:structure

# Validate internal contracts
pnpm run validate:service-map
pnpm run validate:domain-model
pnpm run validate:authorization-model

# Validate deployment
pnpm run validate:deployment-topology
pnpm run validate:image-policy
pnpm run validate:gateway-policy

# Validate APIs
pnpm run validate:public-api
pnpm run validate:openapi

# Run all validations
pnpm run validate:structure && \
pnpm run validate:service-map && \
pnpm run validate:domain-model && \
pnpm run validate:deployment-topology
```

## Testing

### Unit Tests

```bash
# Run all tests
node --test tests/unit/

# Run specific test
node --test tests/unit/keycloak-admin.test.mjs
```

Tests use Node.js built-in `node:test` runner with `node:assert` — no external test frameworks.

### E2E Tests

```bash
# Requires a running platform instance
node --test tests/e2e/
```

### Security Hardening Tests

```bash
node --test tests/hardening/
```

## Internal Contracts

When modifying platform behavior, update the relevant contract in `services/internal-contracts/src/`:

| Contract | Update When |
|----------|------------|
| `domain-model.json` | Adding/modifying entities or fields |
| `deployment-topology.json` | Changing Helm values or bootstrap |
| `authorization-model.json` | Modifying auth rules or scopes |
| `internal-service-map.json` | Adding services or dependencies |
| `public-api-taxonomy.json` | Adding/modifying API routes |
| `observability-*.json` | Changing metrics, alerts, dashboards |

Contracts are validated by CI — breaking changes will fail the pipeline.

## Adding a New Service

1. Create the directory under `services/` or `apps/`
2. Add a `package.json` with `@in-falcone/` scope
3. Register in `pnpm-workspace.yaml` if not under a wildcard path
4. Update `services/internal-contracts/src/internal-service-map.json`
5. Add Helm configuration if the service is deployable
6. Write an ADR if the service introduces a new architectural concept

## Adding a New ADR

```bash
# Create new ADR
cp docs/adr/0001-monorepo-bootstrap.md docs/adr/NNNN-your-title.md
```

Every ADR should include:
1. **Context** — Why was this decision needed?
2. **Decision** — What was decided?
3. **Consequences** — Positive and negative trade-offs
4. **Status** — Proposed → Accepted → Deprecated → Superseded

## Documentation

This documentation site lives in `docs-site/` and uses [VitePress](https://vitepress.dev/):

```bash
cd docs-site

# Development server
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview
```

Documentation is automatically deployed to GitHub Pages on push to `main`.
