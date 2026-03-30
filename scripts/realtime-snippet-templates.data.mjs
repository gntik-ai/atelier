export const realtimeSnippetTemplates = [
  {
    id: 'realtime-js-browser-basic',
    language: 'javascript',
    template: `// Requires: a valid Keycloak access token for this workspace
const ENDPOINT = '{REALTIME_ENDPOINT}'
const WORKSPACE_ID = '{WORKSPACE_ID}'
const TOKEN = '<YOUR_ACCESS_TOKEN>'  // replace with your token

const ws = new WebSocket(
  \`\${ENDPOINT}/workspaces/{WORKSPACE_ID}/realtime/connect\`,
  ['v1.atelier.realtime']
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
ws.addEventListener('close', (e) => console.log('Connection closed', e.code, e.reason))`
  },
  {
    id: 'realtime-nodejs-backend-basic',
    language: 'javascript',
    template: `// npm install ws
import WebSocket from 'ws'

const ENDPOINT = '{REALTIME_ENDPOINT}'
const WORKSPACE_ID = '{WORKSPACE_ID}'
const SERVICE_ACCOUNT_TOKEN = '<YOUR_SERVICE_ACCOUNT_TOKEN>'  // obtain via client_credentials grant

const ws = new WebSocket(
  \`\${ENDPOINT}/workspaces/{WORKSPACE_ID}/realtime/connect\`,
  { headers: { Authorization: \`Bearer \${SERVICE_ACCOUNT_TOKEN}\` } }
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
ws.on('close', (code, reason) => console.log('Closed', code, reason.toString()))`
  },
  {
    id: 'realtime-python-backend-basic',
    language: 'python',
    template: `# pip install websockets
import asyncio, json, websockets

ENDPOINT = "{REALTIME_ENDPOINT}"
WORKSPACE_ID = "{WORKSPACE_ID}"
SERVICE_ACCOUNT_TOKEN = "<YOUR_SERVICE_ACCOUNT_TOKEN>"

async def subscribe():
    uri = f"{ENDPOINT}/workspaces/{WORKSPACE_ID}/realtime/connect"
    headers = {"Authorization": f"Bearer {SERVICE_ACCOUNT_TOKEN}"}
    async with websockets.connect(uri, additional_headers=headers) as ws:
        await ws.send(json.dumps({
            "type": "subscribe",
            "channelType": "{CHANNEL_TYPE}",
            "filter": {}
        }))
        async for message in ws:
            msg = json.loads(message)
            if msg.get("type") == "event":
                print("Event:", msg["payload"])

asyncio.run(subscribe())`
  },
  {
    id: 'realtime-js-browser-filter', language: 'javascript', template: `// Requires: a valid Keycloak access token for this workspace
const ENDPOINT = '{REALTIME_ENDPOINT}'
const WORKSPACE_ID = '{WORKSPACE_ID}'
const TOKEN = '<YOUR_ACCESS_TOKEN>'

const ws = new WebSocket(
  \`\${ENDPOINT}/workspaces/{WORKSPACE_ID}/realtime/connect\`,
  ['v1.atelier.realtime']
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
})` },
  { id: 'realtime-nodejs-backend-filter', language: 'javascript', template: `// npm install ws
import WebSocket from 'ws'

const ENDPOINT = '{REALTIME_ENDPOINT}'
const WORKSPACE_ID = '{WORKSPACE_ID}'
const SERVICE_ACCOUNT_TOKEN = '<YOUR_SERVICE_ACCOUNT_TOKEN>'

const ws = new WebSocket(
  \`\${ENDPOINT}/workspaces/{WORKSPACE_ID}/realtime/connect\`,
  { headers: { Authorization: \`Bearer \${SERVICE_ACCOUNT_TOKEN}\` } }
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
})` },
  { id: 'realtime-python-backend-filter', language: 'python', template: `# pip install websockets
import asyncio, json, websockets

ENDPOINT = "{REALTIME_ENDPOINT}"
WORKSPACE_ID = "{WORKSPACE_ID}"
SERVICE_ACCOUNT_TOKEN = "<YOUR_SERVICE_ACCOUNT_TOKEN>"

async def subscribe():
    uri = f"{ENDPOINT}/workspaces/{WORKSPACE_ID}/realtime/connect"
    headers = {"Authorization": f"Bearer {SERVICE_ACCOUNT_TOKEN}"}
    async with websockets.connect(uri, additional_headers=headers) as ws:
        await ws.send(json.dumps({
            "type": "subscribe",
            "channelType": "{CHANNEL_TYPE}",
            "filter": {"operation": "INSERT", "entity": "orders"}
        }))
        async for message in ws:
            msg = json.loads(message)
            if msg.get("type") == "event":
                print("Filtered event:", msg["payload"])

asyncio.run(subscribe())` },
  { id: 'realtime-js-browser-reconnect', language: 'javascript', template: `const ENDPOINT = '{REALTIME_ENDPOINT}'
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
    \`\${ENDPOINT}/workspaces/{WORKSPACE_ID}/realtime/connect?token=\${encodeURIComponent(token)}\`,
    ['v1.atelier.realtime']
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

connect()` },
  { id: 'realtime-nodejs-backend-reconnect', language: 'javascript', template: `// npm install ws
import WebSocket from 'ws'

const ENDPOINT = '{REALTIME_ENDPOINT}'
const WORKSPACE_ID = '{WORKSPACE_ID}'
const SERVICE_ACCOUNT_TOKEN = '<YOUR_SERVICE_ACCOUNT_TOKEN>'
let attempt = 0

function connect() {
  const ws = new WebSocket(
    \`\${ENDPOINT}/workspaces/{WORKSPACE_ID}/realtime/connect\`,
    { headers: { Authorization: \`Bearer \${SERVICE_ACCOUNT_TOKEN}\` } }
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

connect()` },
  { id: 'realtime-python-backend-reconnect', language: 'python', template: `# pip install websockets
import asyncio, json, websockets

ENDPOINT = "{REALTIME_ENDPOINT}"
WORKSPACE_ID = "{WORKSPACE_ID}"
SERVICE_ACCOUNT_TOKEN = "<YOUR_SERVICE_ACCOUNT_TOKEN>"

async def connect_forever():
    attempt = 0
    while True:
        try:
            uri = f"{ENDPOINT}/workspaces/{WORKSPACE_ID}/realtime/connect"
            headers = {"Authorization": f"Bearer {SERVICE_ACCOUNT_TOKEN}"}
            async with websockets.connect(uri, additional_headers=headers) as ws:
                attempt = 0
                await ws.send(json.dumps({"type": "subscribe", "channelType": "{CHANNEL_TYPE}", "filter": {}}))
                async for message in ws:
                    msg = json.loads(message)
                    if msg.get("type") == "event":
                        print("Event:", msg["payload"])
        except Exception as exc:
            delay = min(1 * 2 ** attempt, 30)
            attempt += 1
            print(f"Realtime connection closed: {exc}")
            # Rotate your service-account token via Keycloak client_credentials if you receive close code 4001.
            await asyncio.sleep(delay)

asyncio.run(connect_forever())` }
]
