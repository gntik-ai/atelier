# Observability

In Falcone includes a built-in observability stack with Prometheus metrics, multi-tenant dashboards, health checks, and an audit pipeline.

## Metrics Stack

### Prometheus

Prometheus 3.2 is deployed as part of the platform (enabled in `standard` and `ha` profiles):

```yaml
observability:
  enabled: true
  image:
    repository: docker.io/prom/prometheus
    tag: "3.2.1"
  persistence:
    enabled: true
    size: 20Gi
  env:
    - name: RETENTION_HOT_DAYS
      value: "15"
    - name: RETENTION_DOWNSAMPLE_DAYS
      value: "90"
    - name: RETENTION_COLD_DAYS
      value: "395"
```

### Scrape Targets

| Component | Port | Path | Interval |
|-----------|------|------|----------|
| APISIX | 9091 | `/apisix/prometheus/metrics` | 15s |
| Kafka | 9308 | `/metrics` | 30s |
| PostgreSQL | 9187 | `/metrics` | 30s |
| MongoDB | 9216 | `/metrics` | 30s |
| OpenWhisk | 3233 | `/metrics` | 60s |
| MinIO | 9000 | `/minio/v2/metrics/cluster` | 30s |
| Control Plane | 8080 | `/metrics` | 15s |

### Metric Scoping

Metrics are labeled for multi-tenant isolation:

| Label | Values | Description |
|-------|--------|-------------|
| `environment` | dev, staging, prod | Deployment environment |
| `subsystem` | apisix, keycloak, postgres... | Component name |
| `metricScope` | platform, tenant, workspace | Isolation level |
| `collectionMode` | push, pull | Collection method |

## Health Checks

### Platform Health

```
GET /health
```

Returns the aggregate health status of all components:

```json
{
  "status": "healthy",
  "components": {
    "apisix": { "status": "healthy", "latency": "2ms" },
    "keycloak": { "status": "healthy", "latency": "15ms" },
    "postgresql": { "status": "healthy", "latency": "3ms" },
    "mongodb": { "status": "healthy", "latency": "5ms" },
    "kafka": { "status": "healthy", "latency": "8ms" },
    "openwhisk": { "status": "healthy", "latency": "12ms" },
    "storage": { "status": "healthy", "latency": "4ms" }
  },
  "timestamp": "2024-01-15T10:00:00.000Z"
}
```

### Component Health Checks

Each component has its own health endpoint verified by Kubernetes liveness and readiness probes.

## Dashboards

### Platform Overview Dashboard

Key metrics:
- Request rate (req/s) by route family
- Error rate (4xx, 5xx) by component
- P50/P95/P99 latency by endpoint
- Active connections (WebSocket, database)
- Kafka consumer lag
- Storage utilization

### Tenant Usage Dashboard

Per-tenant metrics:
- API calls per tenant/workspace
- Database storage per workspace
- Object storage usage
- Function invocations
- Event throughput
- Quota utilization (% of limit)

### Infrastructure Dashboard

- CPU/memory utilization per pod
- Disk I/O for StatefulSets
- Network throughput
- Pod restart count
- PVC usage percentage

## Alerts

### Threshold Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| High Error Rate | 5xx > 5% for 5 min | Critical |
| High Latency | P95 > 2s for 5 min | Warning |
| Database Connection Pool | > 80% utilized | Warning |
| Disk Usage | > 85% PVC used | Warning |
| Disk Usage Critical | > 95% PVC used | Critical |
| Kafka Consumer Lag | > 10,000 messages | Warning |
| Pod Restart Loop | > 3 restarts in 5 min | Critical |
| Certificate Expiry | < 7 days | Warning |

### Quota Alerts

| Alert | Condition | Action |
|-------|-----------|--------|
| Soft Limit Reached | Usage > soft limit | Notify tenant admin |
| Hard Limit Reached | Usage > hard limit | Block further requests |
| Approaching Quota | Usage > 80% of limit | Warn tenant admin |

## Audit Pipeline

### Event Flow

```
Service Operation
    │
    ├── Emit audit event → Kafka (console.audit.*)
    │
    ▼
Audit Consumer
    │
    ├── Parse and validate event schema
    ├── Enrich with correlation data
    ├── Store in PostgreSQL (audit tables)
    └── Update Prometheus counters
```

### Audit Event Schema

```json
{
  "eventId": "evt_01HXXX",
  "correlationId": "corr-abc-123",
  "timestamp": "2024-01-15T10:00:00.000Z",
  "actor": {
    "type": "user | service_account | system",
    "id": "usr_01HXXX",
    "roles": ["platform_admin"],
    "tenantId": "tnt_01HXXX"
  },
  "resource": {
    "type": "workspace | table | document | function | ...",
    "id": "wks_01HXXX",
    "name": "dev-environment"
  },
  "action": "workspace.create",
  "outcome": "success | failure | denied",
  "details": { ... },
  "metadata": {
    "sourceService": "control-plane",
    "apiVersion": "2024-01-01",
    "requestMethod": "POST",
    "requestPath": "/v1/workspaces"
  }
}
```

### Audit Topics

| Topic | Events |
|-------|--------|
| `console.audit.platform` | Platform-level operations |
| `console.audit.tenants` | Tenant lifecycle events |
| `console.audit.workspaces` | Workspace operations |
| `console.audit.data` | Data API operations |
| `console.audit.functions` | Function deployments/invocations |
| `console.audit.auth` | Authentication events |
| `console.audit.secrets` | Secret access events |
| `console.realtime.*` | Realtime connection events |
| `console.pg-capture.*` | PostgreSQL CDC events |

### Querying Audit Logs

Audit logs can be queried through the Control Plane API:

```bash
curl "http://localhost:9080/v1/platform/audit?\
actor.id=usr_01HXXX&\
action=workspace.create&\
from=2024-01-01T00:00:00Z&\
to=2024-01-31T23:59:59Z&\
limit=50" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Version: 2024-01-01"
```

## Accessing Prometheus

```bash
# Port-forward
kubectl port-forward -n in-falcone-dev svc/in-falcone-observability 9090:9090

# Open http://localhost:9090

# Example queries
# Request rate by route
rate(apisix_http_requests_total[5m])

# Error rate
sum(rate(apisix_http_status{code=~"5.."}[5m])) / sum(rate(apisix_http_requests_total[5m]))

# P95 latency
histogram_quantile(0.95, rate(apisix_http_latency_bucket[5m]))
```
