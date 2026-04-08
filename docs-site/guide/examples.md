# Usage Examples

Practical examples covering the most common operations with In Falcone.

## Tenant & Workspace Management

### List All Tenants

```bash
curl -s http://localhost:9080/v1/tenants \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Version: 2024-01-01" | jq .
```

### Update a Tenant Plan

```bash
curl -s -X PATCH http://localhost:9080/v1/tenants/$TENANT_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -H "X-Correlation-Id: upgrade-$(date +%s)" \
  -d '{
    "plan": "growth"
  }' | jq .
```

### Create a Service Account

```bash
curl -s -X POST http://localhost:9080/v1/workspaces/$WORKSPACE_ID/service-accounts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -H "Idempotency-Key: create-sa-001" \
  -d '{
    "slug": "backend-worker",
    "displayName": "Backend Worker Service",
    "scopes": ["postgres:read", "postgres:write", "mongo:read", "events:publish"]
  }' | jq .
```

### Register an External Application

```bash
curl -s -X POST http://localhost:9080/v1/workspaces/$WORKSPACE_ID/applications \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -H "Idempotency-Key: create-app-001" \
  -d '{
    "slug": "mobile-app",
    "displayName": "Mobile Application",
    "redirectUris": ["https://app.acme.com/callback"],
    "allowedOrigins": ["https://app.acme.com"]
  }' | jq .
```

## PostgreSQL Operations

### Advanced Queries

```bash
# Filter with multiple conditions
curl -s "http://localhost:9080/v1/postgres/$WORKSPACE_ID/rows/products?\
category=eq.electronics&\
price=gte.50&\
price=lte.200&\
order=price.asc&\
limit=20" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Version: 2024-01-01" | jq .

# Select specific columns
curl -s "http://localhost:9080/v1/postgres/$WORKSPACE_ID/rows/products?\
select=name,price,category&\
order=created_at.desc" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Version: 2024-01-01" | jq .

# Text search with LIKE
curl -s "http://localhost:9080/v1/postgres/$WORKSPACE_ID/rows/products?\
name=like.*Wireless*" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Version: 2024-01-01" | jq .
```

### Batch Insert

```bash
curl -s -X POST "http://localhost:9080/v1/postgres/$WORKSPACE_ID/rows/products" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -H "Idempotency-Key: batch-insert-001" \
  -d '[
    { "name": "USB-C Cable", "price": 12.99, "category": "accessories" },
    { "name": "Laptop Stand", "price": 45.00, "category": "accessories" },
    { "name": "Mechanical Keyboard", "price": 149.99, "category": "electronics" }
  ]' | jq .
```

### Update with Conditions

```bash
curl -s -X PATCH "http://localhost:9080/v1/postgres/$WORKSPACE_ID/rows/products?\
category=eq.electronics&\
price=lt.100" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -H "Idempotency-Key: discount-001" \
  -d '{
    "price": 69.99
  }' | jq .
```

### Cursor-based Pagination

```bash
# First page
curl -s "http://localhost:9080/v1/postgres/$WORKSPACE_ID/rows/products?\
order=created_at.asc&\
limit=10" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Version: 2024-01-01" | jq .

# Next page (use the last item's created_at value)
curl -s "http://localhost:9080/v1/postgres/$WORKSPACE_ID/rows/products?\
order=created_at.asc&\
created_at=gt.2024-01-15T10:00:00.000Z&\
limit=10" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Version: 2024-01-01" | jq .
```

## MongoDB Operations

### Insert with Nested Documents

```bash
curl -s -X POST "http://localhost:9080/v1/mongo/$WORKSPACE_ID/collections/orders/documents" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -H "Idempotency-Key: order-001" \
  -d '{
    "orderId": "ORD-2024-0001",
    "customer": {
      "name": "Jane Doe",
      "email": "jane@acme.com"
    },
    "items": [
      { "product": "Wireless Headphones", "qty": 2, "unitPrice": 79.99 },
      { "product": "USB-C Cable", "qty": 3, "unitPrice": 12.99 }
    ],
    "total": 198.95,
    "status": "pending",
    "createdAt": "2024-01-15T11:00:00.000Z"
  }' | jq .
```

### Update with MongoDB Operators

```bash
DOC_ID="the-document-id"

curl -s -X PATCH "http://localhost:9080/v1/mongo/$WORKSPACE_ID/collections/orders/documents/$DOC_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -H "Idempotency-Key: update-order-001" \
  -d '{
    "$set": { "status": "shipped" },
    "$push": {
      "timeline": {
        "event": "shipped",
        "timestamp": "2024-01-16T09:00:00.000Z"
      }
    },
    "$inc": { "version": 1 }
  }' | jq .
```

### Aggregation Pipeline

```bash
curl -s -X POST "http://localhost:9080/v1/mongo/$WORKSPACE_ID/collections/orders/aggregate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -d '{
    "pipeline": [
      { "$match": { "status": "shipped" } },
      { "$unwind": "$items" },
      { "$group": {
          "_id": "$items.product",
          "totalQuantity": { "$sum": "$items.qty" },
          "totalRevenue": { "$sum": { "$multiply": ["$items.qty", "$items.unitPrice"] } }
      }},
      { "$sort": { "totalRevenue": -1 } },
      { "$limit": 10 }
    ]
  }' | jq .
```

### Bulk Operations

```bash
curl -s -X POST "http://localhost:9080/v1/mongo/$WORKSPACE_ID/collections/logs/bulk" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -H "Idempotency-Key: bulk-logs-001" \
  -d '{
    "operations": [
      { "insertOne": { "document": { "level": "info", "message": "Request started" } } },
      { "insertOne": { "document": { "level": "info", "message": "Request completed" } } },
      { "updateMany": { "filter": { "level": "debug" }, "update": { "$set": { "archived": true } } } }
    ]
  }' | jq .
```

## Realtime Subscriptions

### Frontend (Browser)

```html
<!DOCTYPE html>
<html>
<head><title>Falcone Realtime Demo</title></head>
<body>
  <h1>Realtime Events</h1>
  <div id="events"></div>

  <script>
    const WORKSPACE_ID = 'wks_01HXXXXXXXXXXXXXXXXXXXXXXX';
    const TOKEN = 'your-access-token';

    const ws = new WebSocket(
      `ws://localhost:9080/workspaces/${WORKSPACE_ID}/realtime/connect`
    );

    ws.onopen = () => {
      // Authenticate
      ws.send(JSON.stringify({
        type: 'auth',
        token: TOKEN
      }));

      // Subscribe to PostgreSQL changes
      ws.send(JSON.stringify({
        type: 'subscribe',
        channel: 'postgres:products',
        filter: { operations: ['INSERT', 'UPDATE', 'DELETE'] }
      }));

      // Subscribe to MongoDB changes
      ws.send(JSON.stringify({
        type: 'subscribe',
        channel: 'mongo:orders',
        filter: { operations: ['INSERT', 'UPDATE'] }
      }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const el = document.createElement('pre');
      el.textContent = JSON.stringify(data, null, 2);
      document.getElementById('events').prepend(el);
    };

    ws.onerror = (err) => console.error('WebSocket error:', err);
    ws.onclose = (e) => console.log('Connection closed:', e.code, e.reason);
  </script>
</body>
</html>
```

### Node.js Backend

```javascript
import WebSocket from 'ws';

const WORKSPACE_ID = 'wks_01HXXXXXXXXXXXXXXXXXXXXXXX';
const KEYCLOAK_URL = 'http://localhost:8080';
const GATEWAY_URL = 'ws://localhost:9080';

// 1. Get a service account token
async function getToken() {
  const res = await fetch(
    `${KEYCLOAK_URL}/realms/in-falcone-platform/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'backend-worker',
        client_secret: 'your-client-secret',
      }),
    }
  );
  const { access_token } = await res.json();
  return access_token;
}

// 2. Connect and subscribe
async function main() {
  const token = await getToken();

  const ws = new WebSocket(
    `${GATEWAY_URL}/workspaces/${WORKSPACE_ID}/realtime/connect`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  ws.on('open', () => {
    console.log('Connected to realtime gateway');
    ws.send(JSON.stringify({
      type: 'subscribe',
      channel: 'postgres:products',
      filter: { operations: ['INSERT', 'UPDATE'] }
    }));
  });

  ws.on('message', (raw) => {
    const event = JSON.parse(raw.toString());
    console.log('Event received:', event);

    // Process the event (e.g., update cache, trigger notification)
    if (event.operation === 'INSERT') {
      console.log('New product:', event.record.name);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`Disconnected: ${code} - ${reason}`);
    // Implement reconnection with exponential backoff
    setTimeout(main, 2000);
  });

  ws.on('error', (err) => console.error('WS Error:', err.message));
}

main().catch(console.error);
```

### Python Backend

```python
import asyncio
import json
import httpx
import websockets

WORKSPACE_ID = "wks_01HXXXXXXXXXXXXXXXXXXXXXXX"
KEYCLOAK_URL = "http://localhost:8080"
GATEWAY_URL = "ws://localhost:9080"


async def get_token():
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{KEYCLOAK_URL}/realms/in-falcone-platform/protocol/openid-connect/token",
            data={
                "grant_type": "client_credentials",
                "client_id": "backend-worker",
                "client_secret": "your-client-secret",
            },
        )
        return resp.json()["access_token"]


async def subscribe():
    token = await get_token()
    uri = f"{GATEWAY_URL}/workspaces/{WORKSPACE_ID}/realtime/connect"
    headers = {"Authorization": f"Bearer {token}"}

    async with websockets.connect(uri, extra_headers=headers) as ws:
        # Subscribe to changes
        await ws.send(json.dumps({
            "type": "subscribe",
            "channel": "postgres:products",
            "filter": {"operations": ["INSERT", "UPDATE", "DELETE"]},
        }))
        print("Subscribed to products changes")

        async for message in ws:
            event = json.loads(message)
            print(f"Event: {event['operation']} on {event.get('table', 'unknown')}")
            print(f"  Record: {json.dumps(event.get('record', {}), indent=2)}")


if __name__ == "__main__":
    asyncio.run(subscribe())
```

## Event Publishing

### Publish a Custom Event

```bash
curl -s -X POST "http://localhost:9080/v1/events/$WORKSPACE_ID/publish" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -H "Idempotency-Key: event-001" \
  -H "X-Correlation-Id: flow-$(date +%s)" \
  -d '{
    "topic": "user.actions",
    "key": "usr_123",
    "payload": {
      "action": "checkout_completed",
      "orderId": "ORD-2024-0001",
      "amount": 198.95,
      "currency": "USD"
    }
  }' | jq .
```

## Serverless Functions

### Deploy a Function

```bash
curl -s -X POST "http://localhost:9080/v1/functions/$WORKSPACE_ID/actions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -H "Idempotency-Key: deploy-fn-001" \
  -d '{
    "name": "process-order",
    "runtime": "nodejs:20",
    "code": "async function main(params) { return { statusCode: 200, body: { processed: true, orderId: params.orderId } }; }",
    "memory": 256,
    "timeout": 30000
  }' | jq .
```

### Invoke a Function

```bash
curl -s -X POST "http://localhost:9080/v1/functions/$WORKSPACE_ID/actions/process-order/invoke" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 2024-01-01" \
  -d '{
    "orderId": "ORD-2024-0001"
  }' | jq .
```

## Object Storage

### Upload a File

```bash
curl -s -X PUT "http://localhost:9080/v1/storage/$WORKSPACE_ID/objects/reports/monthly-2024-01.pdf" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/pdf" \
  -H "X-API-Version: 2024-01-01" \
  --data-binary @monthly-report.pdf | jq .
```

### List Objects

```bash
curl -s "http://localhost:9080/v1/storage/$WORKSPACE_ID/objects?prefix=reports/&limit=50" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Version: 2024-01-01" | jq .
```

### Download a File

```bash
curl -s "http://localhost:9080/v1/storage/$WORKSPACE_ID/objects/reports/monthly-2024-01.pdf" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-API-Version: 2024-01-01" \
  -o downloaded-report.pdf
```

## Platform Health

### Check Platform Health

```bash
curl -s http://localhost:9080/health | jq .
```

### View Metrics

```bash
# Port-forward Prometheus
kubectl port-forward -n in-falcone-dev svc/in-falcone-observability 9090:9090

# Query metrics
curl -s "http://localhost:9090/api/v1/query?query=up" | jq .
```
