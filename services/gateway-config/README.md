# Gateway Configuration

Base location for gateway runtime configuration assets.

- `base/`: shared defaults intended to be overlaid per environment
- `base/public-api-routing.yaml`: machine-readable family-to-prefix routing baseline for the unified `/v1/*` public API
- public domain roots and route prefixes live in the base config; environment/platform hostnames are supplied through Helm overlays
- avoid embedding secrets in repository-tracked files
- prefer config maps and sealed/external secrets in deployment layers
