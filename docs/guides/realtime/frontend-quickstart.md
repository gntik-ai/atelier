# Frontend Realtime Quick Start

## Prerequisites

- Platform account with access to the target workspace.
- At least one provisioned data source in the workspace.
- A Keycloak access token obtained with the Authorization Code flow.

## Endpoint discovery

Find the realtime endpoint in the console under workspace Settings → Realtime or via `GET /api/workspaces/{workspaceId}/config`.

## Basic subscription

```javascript
// Requires: a valid Keycloak access token for this workspace
const ENDPOINT = '{REALTIME_ENDPOINT}'
const WORKSPACE_ID = '{WORKSPACE_ID}'
const TOKEN = '<YOUR_ACCESS_TOKEN>'  // replace with your token

const ws = new WebSocket(
  `${ENDPOINT}/workspaces/{WORKSPACE_ID}/realtime/connect`,
  ['v1.falcone.realtime']
)

ws.addEventListener('open', () => {
  void TOKEN
  ws.send(JSON.stringify({
    type: 'subscribe',
    channelType: '{CHANNEL_TYPE}',
    filter: {}
  }))
})

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.type === 'event') {
    console.log('Received event:', msg.payload)
  }
})

ws.addEventListener('error', (err) => console.error('WebSocket error', err))
ws.addEventListener('close', (e) => console.log('Connection closed', e.code, e.reason))
```

## Applying filters

```javascript
// Requires: a valid Keycloak access token for this workspace
const ENDPOINT = '{REALTIME_ENDPOINT}'
const WORKSPACE_ID = '{WORKSPACE_ID}'
const TOKEN = '<YOUR_ACCESS_TOKEN>'

const ws = new WebSocket(
  `${ENDPOINT}/workspaces/{WORKSPACE_ID}/realtime/connect`,
  ['v1.falcone.realtime']
)

ws.addEventListener('open', () => {
  void TOKEN
  ws.send(JSON.stringify({
    type: 'subscribe',
    channelType: '{CHANNEL_TYPE}',
    // Supported filter fields: operation (INSERT|UPDATE|DELETE), entity (table/collection name)
    filter: { operation: 'INSERT', entity: 'orders' }
  }))
})

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.type === 'event') {
    console.log('Filtered event:', msg.payload)
  }
})
```

| Field | Meaning |
|-------|---------|
| `operation` | INSERT, UPDATE or DELETE |
| `entity` | Table or collection name |
| `predicates` | Optional provider-specific filter predicates |

## Reconnection & token refresh

```javascript
const ENDPOINT = '{REALTIME_ENDPOINT}'
const WORKSPACE_ID = '{WORKSPACE_ID}'

let token = '<YOUR_ACCESS_TOKEN>'
let attempt = 0
const MAX_BACKOFF_MS = 30_000

async function refreshToken() {
  // Replace with your token-refresh logic (e.g., Keycloak refresh_token grant)
  const resp = await fetch('/auth/refresh', { method: 'POST' })
  const data = await resp.json()
  return data.access_token
}

function connect() {
  const ws = new WebSocket(
    `${ENDPOINT}/workspaces/{WORKSPACE_ID}/realtime/connect?token=${encodeURIComponent(token)}`,
    ['v1.falcone.realtime']
  )

  ws.addEventListener('open', () => {
    attempt = 0
    ws.send(JSON.stringify({ type: 'subscribe', channelType: '{CHANNEL_TYPE}', filter: {} }))
  })

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.type === 'event') console.log('Event:', msg.payload)
    if (msg.type === 'token_expired') {
      ws.close(4001, 'token_expired')
    }
  })

  ws.addEventListener('close', async (e) => {
    const backoff = Math.min(1_000 * 2 ** attempt, MAX_BACKOFF_MS)
    attempt++
    if (e.code === 4001) {
      token = await refreshToken()
    }
    setTimeout(connect, backoff)
  })
}

connect()
```

## Common error codes

| Code | Meaning | Resolution |
|------|---------|-----------|
| 4001 | `token_expired` | Refresh access token via Keycloak refresh_token grant and reconnect |
| 4003 | `scope_denied` | Verify the token includes the required `realtime:subscribe` scope |
| 4008 | `quota_exceeded` | Concurrent subscription limit reached; close unused subscriptions |
| 4010 | `channel_unavailable` | Requested channel type not provisioned for this workspace |
