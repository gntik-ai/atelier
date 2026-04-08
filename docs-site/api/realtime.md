# Realtime Subscriptions

WebSocket-based realtime event delivery for workspace data changes and custom events.

## Connection

### Endpoint

```
ws://<gateway>/workspaces/:workspaceId/realtime/connect
```

### Authentication

Include the Keycloak JWT in the connection:

```javascript
// Browser
const ws = new WebSocket(url);
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'auth', token: ACCESS_TOKEN }));
};

// Node.js (via headers)
const ws = new WebSocket(url, {
  headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
});
```

## Message Protocol

### Subscribe

```json
{
  "type": "subscribe",
  "channel": "postgres:products",
  "filter": {
    "operations": ["INSERT", "UPDATE", "DELETE"],
    "entity": "products"
  }
}
```

### Unsubscribe

```json
{
  "type": "unsubscribe",
  "channel": "postgres:products"
}
```

### Event Message (Server → Client)

```json
{
  "type": "event",
  "channel": "postgres:products",
  "operation": "INSERT",
  "table": "products",
  "record": {
    "id": "550e8400-...",
    "name": "New Product",
    "price": 29.99
  },
  "timestamp": "2024-01-15T10:00:00.000Z",
  "correlationId": "corr-abc-123"
}
```

## Channels

### PostgreSQL Channels

Subscribe to row-level changes on PostgreSQL tables:

| Channel | Description |
|---------|-------------|
| `postgres:*` | All table changes |
| `postgres:{table}` | Changes on a specific table |

**Event payload:**

```json
{
  "operation": "UPDATE",
  "table": "products",
  "record": { "id": "...", "name": "...", "price": 99.99 },
  "oldRecord": { "id": "...", "name": "...", "price": 79.99 },
  "changedColumns": ["price"]
}
```

### MongoDB Channels

Subscribe to document-level changes:

| Channel | Description |
|---------|-------------|
| `mongo:*` | All collection changes |
| `mongo:{collection}` | Changes on a specific collection |

**Event payload:**

```json
{
  "operation": "INSERT",
  "collection": "orders",
  "document": { "_id": "...", "orderId": "ORD-001", "total": 198.95 },
  "operationType": "insert"
}
```

### Custom Event Channels

Subscribe to application-published events:

| Channel | Description |
|---------|-------------|
| `events:*` | All custom events |
| `events:{topic}` | Events on a specific topic |

## Filters

### Operation Filter

Receive only specific operations:

```json
{
  "filter": {
    "operations": ["INSERT", "UPDATE"]
  }
}
```

### Entity Filter

Limit to specific tables/collections:

```json
{
  "filter": {
    "entity": "products"
  }
}
```

### Predicate Filter

Apply server-side filtering (reduces bandwidth):

```json
{
  "filter": {
    "predicates": {
      "category": "electronics",
      "price": { "$gte": 100 }
    }
  }
}
```

## Error Codes

| Code | Name | Description | Action |
|------|------|-------------|--------|
| `4001` | `token_expired` | JWT has expired | Refresh token and reconnect |
| `4003` | `scope_denied` | Insufficient permissions | Check workspace access |
| `4008` | `quota_exceeded` | Subscription limit reached | Upgrade plan or reduce subscriptions |
| `4010` | `channel_unavailable` | Channel does not exist | Verify channel name |

## Reconnection

Implement exponential backoff for reconnections:

```javascript
let retryDelay = 1000; // Start with 1 second
const maxDelay = 30000; // Max 30 seconds

function connect() {
  const ws = new WebSocket(url);

  ws.onopen = () => {
    retryDelay = 1000; // Reset on successful connection
    authenticate(ws);
    subscribe(ws);
  };

  ws.onclose = (event) => {
    if (event.code === 4001) {
      // Token expired: refresh token first
      refreshToken().then(connect);
      return;
    }

    console.log(`Reconnecting in ${retryDelay}ms...`);
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, maxDelay);
  };
}
```

## Audit

All realtime connection events are published to Kafka audit topics:

| Topic | Event |
|-------|-------|
| `console.realtime.auth-granted` | Successful authentication |
| `console.realtime.auth-denied` | Failed authentication |
| `console.realtime.session-suspended` | Connection suspended (quota/error) |
| `console.realtime.session-resumed` | Connection resumed |

## Quickstart Examples

- [Frontend (Browser)](/guide/examples#frontend-browser)
- [Node.js Backend](/guide/examples#node-js-backend)
- [Python Backend](/guide/examples#python-backend)
