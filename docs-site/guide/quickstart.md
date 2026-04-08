# Quickstart

Get In Falcone running and create your first tenant, workspace, and data operations in under 10 minutes.

## Prerequisites

- A running Kubernetes cluster (minikube, kind, or cloud-managed)
- `helm` 3.12+ and `kubectl` installed
- `curl` for API testing

## 1. Deploy the Platform

```bash
# Clone and enter the repo
git clone https://github.com/gntik-ai/falcone.git
cd falcone

# Build Helm dependencies
helm dependency build charts/in-falcone

# Deploy with the all-in-one development profile
helm upgrade --install in-falcone charts/in-falcone \
  --namespace in-falcone-dev \
  --create-namespace \
  -f charts/in-falcone/values.yaml \
  -f charts/in-falcone/values/profiles/all-in-one.yaml \
  -f charts/in-falcone/values/dev.yaml \
  -f charts/in-falcone/values/platform-kubernetes.yaml
```

Wait for all pods to become ready:

```bash
kubectl wait --for=condition=ready pod -l app.kubernetes.io/part-of=in-falcone \
  -n in-falcone-dev --timeout=300s
```

## 2. Set Up Port Forwarding

Open three terminals for the key services:

```bash
# Terminal 1: API Gateway
kubectl port-forward -n in-falcone-dev svc/in-falcone-apisix 9080:9080

# Terminal 2: Web Console
kubectl port-forward -n in-falcone-dev svc/in-falcone-web-console 3000:3000

# Terminal 3: Keycloak
kubectl port-forward -n in-falcone-dev svc/in-falcone-keycloak 8080:8080
```

## 3. Authenticate

Obtain a platform admin token from Keycloak:

```bash
# Get an access token
TOKEN=$(curl -s -X POST \
  http://localhost:8080/realms/in-falcone-platform/protocol/openid-connect/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=password' \
  -d 'client_id=in-falcone-console' \
  -d 'username=admin' \
  -d 'password=admin' | jq -r '.access_token')

echo "Token acquired: ${TOKEN:0:20}..."
```

::: tip
The default dev credentials are `admin/admin`. Change these immediately in non-development environments.
:::

## 4. Create a Tenant

```bash
curl -s -X POST http://localhost:9080/v1/tenants \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -H "X-Correlation-Id: qs-$(date +%s)" \
  -d '{
    "slug": "acme-corp",
    "displayName": "Acme Corporation",
    "plan": "starter",
    "adminEmail": "admin@acme.example.com"
  }' | jq .
```

Expected response:

```json
{
  "id": "tnt_01HXXXXXXXXXXXXXXXXXXXXXXX",
  "slug": "acme-corp",
  "displayName": "Acme Corporation",
  "plan": "starter",
  "status": "active",
  "createdAt": "2024-01-15T10:00:00.000Z"
}
```

## 5. Create a Workspace

```bash
TENANT_ID="tnt_01HXXXXXXXXXXXXXXXXXXXXXXX"  # Use the ID from step 4

curl -s -X POST http://localhost:9080/v1/workspaces \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -H "X-Correlation-Id: qs-$(date +%s)" \
  -d "{
    \"tenantId\": \"$TENANT_ID\",
    \"slug\": \"dev-environment\",
    \"displayName\": \"Development Environment\",
    \"capabilities\": [\"postgres\", \"mongo\", \"kafka\", \"storage\"]
  }" | jq .
```

## 6. Use the PostgreSQL Data API

### Create a Table

```bash
WORKSPACE_ID="wks_01HXXXXXXXXXXXXXXXXXXXXXXX"  # Use the ID from step 5

curl -s -X POST "http://localhost:9080/v1/postgres/$WORKSPACE_ID/tables" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -H "X-Correlation-Id: qs-$(date +%s)" \
  -d '{
    "name": "products",
    "columns": [
      { "name": "id", "type": "uuid", "primaryKey": true, "default": "gen_random_uuid()" },
      { "name": "name", "type": "text", "nullable": false },
      { "name": "price", "type": "numeric(10,2)", "nullable": false },
      { "name": "category", "type": "text" },
      { "name": "created_at", "type": "timestamptz", "default": "now()" }
    ]
  }' | jq .
```

### Insert Data

```bash
curl -s -X POST "http://localhost:9080/v1/postgres/$WORKSPACE_ID/rows/products" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -H "Idempotency-Key: insert-product-001" \
  -H "X-Correlation-Id: qs-$(date +%s)" \
  -d '{
    "name": "Wireless Headphones",
    "price": 79.99,
    "category": "electronics"
  }' | jq .
```

### Query Data

```bash
# Get all products
curl -s "http://localhost:9080/v1/postgres/$WORKSPACE_ID/rows/products" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Version: 2024-01-01" | jq .

# Filter by category
curl -s "http://localhost:9080/v1/postgres/$WORKSPACE_ID/rows/products?category=eq.electronics&order=price.desc" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Version: 2024-01-01" | jq .
```

## 7. Use the MongoDB Data API

### Insert a Document

```bash
curl -s -X POST "http://localhost:9080/v1/mongo/$WORKSPACE_ID/collections/logs/documents" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -H "Idempotency-Key: insert-log-001" \
  -H "X-Correlation-Id: qs-$(date +%s)" \
  -d '{
    "level": "info",
    "message": "User signed in",
    "metadata": {
      "userId": "usr_123",
      "ip": "192.168.1.1",
      "userAgent": "Mozilla/5.0"
    },
    "timestamp": "2024-01-15T10:30:00.000Z"
  }' | jq .
```

### Query Documents

```bash
curl -s "http://localhost:9080/v1/mongo/$WORKSPACE_ID/collections/logs/documents?filter.level=info&sort=-timestamp&limit=10" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Version: 2024-01-01" | jq .
```

## 8. Connect to Realtime Events

Subscribe to workspace events via WebSocket:

```javascript
// In a browser console or Node.js script
const ws = new WebSocket(
  `ws://localhost:9080/workspaces/${WORKSPACE_ID}/realtime/connect`,
  { headers: { Authorization: `Bearer ${TOKEN}` } }
);

ws.onopen = () => {
  // Subscribe to all PostgreSQL changes on the products table
  ws.send(JSON.stringify({
    type: 'subscribe',
    channel: 'postgres:products',
    filter: {
      operations: ['INSERT', 'UPDATE', 'DELETE']
    }
  }));
  console.log('Subscribed to products changes');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Realtime event:', data);
};
```

Now insert or update a product in another terminal — you'll see the event arrive in realtime.

## 9. Open the Web Console

Navigate to `http://localhost:3000` and log in with:
- **Username:** `admin`
- **Password:** `admin`

From the console you can:
- View and manage tenants
- Create and configure workspaces
- Browse database tables and documents
- Monitor platform health and metrics
- View audit logs

## What's Next?

| Task | Guide |
|------|-------|
| Full installation options | [Installation Guide](/guide/installation) |
| More API examples | [Usage Examples](/guide/examples) |
| PostgreSQL API reference | [PostgreSQL Data API](/api/postgresql) |
| MongoDB API reference | [MongoDB Data API](/api/mongodb) |
| Realtime subscriptions | [Realtime API](/api/realtime) |
| Production deployment | [Helm Configuration](/operations/helm-configuration) |
