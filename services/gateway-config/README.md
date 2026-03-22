# Gateway Configuration

Base location for gateway runtime configuration assets.

- `base/`: shared defaults intended to be overlaid per environment
- avoid embedding secrets in repository-tracked files
- prefer config maps and sealed/external secrets in deployment layers
