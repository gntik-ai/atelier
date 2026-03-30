# Node.js Realtime Quick Start

## Prerequisites

- Node.js 18+.
- Service account with permission to subscribe to realtime channels.
- Workspace with at least one provisioned data source.

## Service-account token

```bash
curl -X POST 'https://<KEYCLOAK_HOST>/realms/<realm>/protocol/openid-connect/token' \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode 'client_id=<CLIENT_ID>' \
  --data-urlencode 'client_secret=<CLIENT_SECRET>'
```

## Endpoint discovery

Find the realtime endpoint in the console under workspace Settings → Realtime or via `GET /api/workspaces/{workspaceId}/config`.

## Basic subscription

```javascript
// npm install ws
import WebSocket from 'ws'

const ENDPOINT = '{REALTIME_ENDPOINT}'
const WORKSPACE_ID = '{WORKSPACE_ID}'
const SERVICE_ACCOUNT_TOKEN = '<YOUR_SERVICE_ACCOUNT_TOKEN>'  // obtain via client_credentials grant

const ws = new WebSocket(
  `${ENDPOINT}/workspaces/{WORKSPACE_ID}/realtime/connect`,
  { headers: { Authorization: `Bearer ${SERVICE_ACCOUNT_TOKEN}` } }
)

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    channelType: '{CHANNEL_TYPE}',
    filter: {}
  }))
})

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString())
  if (msg.type === 'event') {
    console.log('Event received:', msg.payload)
  }
})

ws.on('error', (err) => console.error('WS error', err))
ws.on('close', (code, reason) => console.log('Closed', code, reason.toString()))
```

## Applying filters

```javascript
// npm install ws
import WebSocket from 'ws'

const ENDPOINT = '{REALTIME_ENDPOINT}'
const WORKSPACE_ID = '{WORKSPACE_ID}'
const SERVICE_ACCOUNT_TOKEN = '<YOUR_SERVICE_ACCOUNT_TOKEN>'

const ws = new WebSocket(
  `${ENDPOINT}/workspaces/{WORKSPACE_ID}/realtime/connect`,
  { headers: { Authorization: `Bearer ${SERVICE_ACCOUNT_TOKEN}` } }
)

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    channelType: '{CHANNEL_TYPE}',
    filter: { operation: 'INSERT', entity: 'orders' }
  }))
})

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString())
  if (msg.type === 'event') {
    console.log('Filtered event:', msg.payload)
  }
})
```

## Reconnection with backoff

```javascript
// npm install ws
import WebSocket from 'ws'

const ENDPOINT = '{REALTIME_ENDPOINT}'
const WORKSPACE_ID = '{WORKSPACE_ID}'
const SERVICE_ACCOUNT_TOKEN = '<YOUR_SERVICE_ACCOUNT_TOKEN>'
let attempt = 0

function connect() {
  const ws = new WebSocket(
    `${ENDPOINT}/workspaces/{WORKSPACE_ID}/realtime/connect`,
    { headers: { Authorization: `Bearer ${SERVICE_ACCOUNT_TOKEN}` } }
  )

  ws.on('open', () => {
    attempt = 0
    ws.send(JSON.stringify({ type: 'subscribe', channelType: '{CHANNEL_TYPE}', filter: {} }))
  })

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.type === 'event') {
      console.log('Event:', msg.payload)
    }
  })

  ws.on('close', (code) => {
    // Rotate your service-account token via Keycloak client_credentials if you receive close code 4001
    const delay = Math.min(1000 * 2 ** attempt, 30000)
    attempt++
    setTimeout(connect, delay)
    if (code === 4001) {
      console.warn('Service-account token should be rotated before reconnecting.')
    }
  })
}

connect()
```

## Common error codes

| Code | Meaning | Resolution |
|------|---------|-----------|
| 4001 | `token_expired` | Rotate the service-account token and reconnect |
| 4003 | `scope_denied` | Verify the service account has `realtime:subscribe` scope |
| 4008 | `quota_exceeded` | Reduce concurrent subscribers or request a quota increase |
| 4010 | `channel_unavailable` | Provision the requested channel type in the workspace |
