import type { ResourceType } from './snippet-types'

export interface SnippetTemplate {
  id: string
  label: string
  codeTemplate: string
  fallbackNotes?: string[]
  secretTokens?: string[]
  secretPlaceholderRef: string | null
}

const POSTGRES_SECRET_REF = 'Usa la credencial del usuario de base de datos mostrada en la consola del workspace.'
const MONGO_SECRET_REF = 'Usa la contraseña o API key del usuario Mongo provisionado para este workspace.'
const STORAGE_SECRET_REF = 'Sustituye los placeholders por tus access keys del workspace o credenciales temporales.'
const FUNCTION_SECRET_REF = 'Añade tu token/API key real según la política HTTP expuesta por la función.'
const IAM_SECRET_REF = 'Sustituye <CLIENT_SECRET> por el secreto confidencial generado para este cliente IAM.'

export const SNIPPET_CATALOG: Record<ResourceType, SnippetTemplate[]> = {
  'postgres-database': [
    {
      id: 'postgres-uri',
      label: 'URI PostgreSQL',
      codeTemplate: 'postgresql://<PG_USER>:{PASSWORD}@{HOST}:{PORT}/{RESOURCE_NAME}?sslmode=require',
      fallbackNotes: ['Si el endpoint aún no aparece en la consola, usa el placeholder y actualízalo cuando el host quede disponible.'],
      secretTokens: ['{PASSWORD}'],
      secretPlaceholderRef: POSTGRES_SECRET_REF
    },
    {
      id: 'postgres-node-pg',
      label: 'Node.js — pg',
      codeTemplate: `import { Client } from 'pg'\n\nconst client = new Client({\n  host: '{HOST}',\n  port: {PORT},\n  database: '{RESOURCE_NAME}',\n  user: '<PG_USER>',\n  password: '{PASSWORD}',\n  ssl: true\n})\n\nawait client.connect()\nconst result = await client.query('select now()')\nconsole.log(result.rows[0])\nawait client.end()`,
      secretTokens: ['{PASSWORD}'],
      secretPlaceholderRef: POSTGRES_SECRET_REF
    },
    {
      id: 'postgres-python-psycopg2',
      label: 'Python — psycopg2',
      codeTemplate: `import psycopg2\n\nconn = psycopg2.connect(\n    host='{HOST}',\n    port={PORT},\n    dbname='{RESOURCE_NAME}',\n    user='<PG_USER>',\n    password='{PASSWORD}',\n    sslmode='require'\n)\n\nwith conn.cursor() as cur:\n    cur.execute('select current_schema()')\n    print(cur.fetchone())\n\nconn.close()`,
      secretTokens: ['{PASSWORD}'],
      secretPlaceholderRef: POSTGRES_SECRET_REF
    }
  ],
  'mongo-collection': [
    {
      id: 'mongo-uri',
      label: 'MongoDB URI',
      codeTemplate: 'mongodb://<MONGO_USER>:{PASSWORD}@{HOST}:{PORT}/{RESOURCE_EXTRA_A}?authSource=admin&retryWrites=true&w=majority',
      fallbackNotes: ['La colección usa como base la base de datos seleccionada; revisa el placeholder del host si aún no hay endpoint público.'],
      secretTokens: ['{PASSWORD}'],
      secretPlaceholderRef: MONGO_SECRET_REF
    },
    {
      id: 'mongo-node-mongoose',
      label: 'Node.js — mongoose',
      codeTemplate: `import mongoose from 'mongoose'\n\nawait mongoose.connect('mongodb://<MONGO_USER>:{PASSWORD}@{HOST}:{PORT}/{RESOURCE_EXTRA_A}?authSource=admin')\n\nconst collection = mongoose.connection.collection('{RESOURCE_NAME}')\nconst count = await collection.countDocuments()\nconsole.log({ count })\n\nawait mongoose.disconnect()`,
      secretTokens: ['{PASSWORD}'],
      secretPlaceholderRef: MONGO_SECRET_REF
    },
    {
      id: 'mongo-python-pymongo',
      label: 'Python — pymongo',
      codeTemplate: `from pymongo import MongoClient\n\nclient = MongoClient('mongodb://<MONGO_USER>:{PASSWORD}@{HOST}:{PORT}/{RESOURCE_EXTRA_A}?authSource=admin')\ncollection = client['{RESOURCE_EXTRA_A}']['{RESOURCE_NAME}']\nprint(collection.estimated_document_count())\nclient.close()`,
      secretTokens: ['{PASSWORD}'],
      secretPlaceholderRef: MONGO_SECRET_REF
    }
  ],
  'storage-bucket': [
    {
      id: 'storage-aws-cli',
      label: 'AWS CLI — s3',
      codeTemplate: 'aws --endpoint-url {HOST} s3 ls s3://{RESOURCE_NAME} --region {RESOURCE_EXTRA_A}',
      fallbackNotes: ['El endpoint puede seguir siendo interno; si no está publicado, usa el placeholder y la documentación del workspace.'],
      secretTokens: ['<AWS_ACCESS_KEY_ID>', '<AWS_SECRET_ACCESS_KEY>'],
      secretPlaceholderRef: STORAGE_SECRET_REF
    },
    {
      id: 'storage-node-sdk',
      label: 'Node.js — @aws-sdk/client-s3',
      codeTemplate: `import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'\n\nconst client = new S3Client({\n  endpoint: '{HOST}',\n  region: '{RESOURCE_EXTRA_A}',\n  credentials: {\n    accessKeyId: '<AWS_ACCESS_KEY_ID>',\n    secretAccessKey: '<AWS_SECRET_ACCESS_KEY>'\n  },\n  forcePathStyle: true\n})\n\nconst result = await client.send(new ListObjectsV2Command({ Bucket: '{RESOURCE_NAME}' }))\nconsole.log(result.Contents ?? [])`,
      secretTokens: ['<AWS_ACCESS_KEY_ID>', '<AWS_SECRET_ACCESS_KEY>'],
      secretPlaceholderRef: STORAGE_SECRET_REF
    },
    {
      id: 'storage-python-boto3',
      label: 'Python — boto3',
      codeTemplate: `import boto3\n\ns3 = boto3.client(\n    's3',\n    endpoint_url='{HOST}',\n    region_name='{RESOURCE_EXTRA_A}',\n    aws_access_key_id='<AWS_ACCESS_KEY_ID>',\n    aws_secret_access_key='<AWS_SECRET_ACCESS_KEY>'\n)\n\nresponse = s3.list_objects_v2(Bucket='{RESOURCE_NAME}')\nprint(response.get('Contents', []))`,
      secretTokens: ['<AWS_ACCESS_KEY_ID>', '<AWS_SECRET_ACCESS_KEY>'],
      secretPlaceholderRef: STORAGE_SECRET_REF
    },
    {
      id: 'storage-curl-presigned',
      label: 'cURL — presigned URL',
      codeTemplate: 'curl -X GET "{RESOURCE_EXTRA_B}"',
      fallbackNotes: ['Sustituye la URL firmada cuando la generes desde la superficie presigned del bucket.'],
      secretTokens: [],
      secretPlaceholderRef: STORAGE_SECRET_REF
    }
  ],
  'serverless-function': [
    {
      id: 'function-curl',
      label: 'cURL',
      codeTemplate: 'curl -X POST "{RESOURCE_EXTRA_B}" -H "Content-Type: application/json" -H "Authorization: Bearer <API_TOKEN>" -d \'{"ping":true}\'' ,
      fallbackNotes: ['Si la exposición HTTP está deshabilitada, la URL se mantiene como placeholder hasta activar el endpoint.'],
      secretTokens: ['<API_TOKEN>'],
      secretPlaceholderRef: FUNCTION_SECRET_REF
    },
    {
      id: 'function-node-fetch',
      label: 'Node.js — fetch',
      codeTemplate: `const response = await fetch('{RESOURCE_EXTRA_B}', {\n  method: 'POST',\n  headers: {\n    'content-type': 'application/json',\n    authorization: 'Bearer <API_TOKEN>'\n  },\n  body: JSON.stringify({ ping: true })\n})\n\nconsole.log(await response.json())`,
      secretTokens: ['<API_TOKEN>'],
      secretPlaceholderRef: FUNCTION_SECRET_REF
    },
    {
      id: 'function-python-requests',
      label: 'Python — requests',
      codeTemplate: `import requests\n\nresponse = requests.post(\n    '{RESOURCE_EXTRA_B}',\n    headers={\n        'content-type': 'application/json',\n        'authorization': 'Bearer <API_TOKEN>'\n    },\n    json={'ping': True}\n)\n\nprint(response.json())`,
      secretTokens: ['<API_TOKEN>'],
      secretPlaceholderRef: FUNCTION_SECRET_REF
    }
  ],
  'realtime-subscription': [
    {
      id: 'realtime-js-browser-basic',
      label: 'JavaScript (browser) — WebSocket subscription',
      codeTemplate: `// Requires: a valid Keycloak access token for this workspace
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
ws.addEventListener('close', (e) => console.log('Connection closed', e.code, e.reason))`,
      secretTokens: ['<YOUR_ACCESS_TOKEN>'],
      secretPlaceholderRef: 'Obtain your access token from Keycloak: POST /realms/<realm>/protocol/openid-connect/token'
    },
    {
      id: 'realtime-nodejs-backend-basic',
      label: 'Node.js (backend) — WebSocket subscription',
      codeTemplate: `// npm install ws
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
ws.on('close', (code, reason) => console.log('Closed', code, reason.toString()))`,
      secretTokens: ['<YOUR_SERVICE_ACCOUNT_TOKEN>'],
      secretPlaceholderRef: 'Obtain a service-account token via Keycloak client_credentials grant with your client_id and client_secret.'
    },
    {
      id: 'realtime-python-backend-basic',
      label: 'Python (backend) — WebSocket subscription',
      codeTemplate: `# pip install websockets
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

asyncio.run(subscribe())`,
      secretTokens: ['<YOUR_SERVICE_ACCOUNT_TOKEN>'],
      secretPlaceholderRef: 'Obtain a service-account token via Keycloak client_credentials grant.'
    },
    {
      id: 'realtime-js-browser-filter',
      label: 'JavaScript (browser) — Filtered subscription',
      codeTemplate: `// Requires: a valid Keycloak access token for this workspace
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
})`,
      secretTokens: ['<YOUR_ACCESS_TOKEN>'],
      secretPlaceholderRef: 'Obtain your access token from Keycloak: POST /realms/<realm>/protocol/openid-connect/token'
    },
    {
      id: 'realtime-nodejs-backend-filter',
      label: 'Node.js (backend) — Filtered subscription',
      codeTemplate: `// npm install ws
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
})`,
      secretTokens: ['<YOUR_SERVICE_ACCOUNT_TOKEN>'],
      secretPlaceholderRef: 'Obtain a service-account token via Keycloak client_credentials grant with your client_id and client_secret.'
    },
    {
      id: 'realtime-python-backend-filter',
      label: 'Python (backend) — Filtered subscription',
      codeTemplate: `# pip install websockets
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

asyncio.run(subscribe())`,
      secretTokens: ['<YOUR_SERVICE_ACCOUNT_TOKEN>'],
      secretPlaceholderRef: 'Obtain a service-account token via Keycloak client_credentials grant.'
    },
    {
      id: 'realtime-js-browser-reconnect',
      label: 'JavaScript (browser) — Reconnection with backoff & token refresh',
      codeTemplate: `const ENDPOINT = '{REALTIME_ENDPOINT}'
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

connect()`,
      secretTokens: ['<YOUR_ACCESS_TOKEN>'],
      secretPlaceholderRef: 'Replace refreshToken() with your Keycloak token-refresh implementation.'
    },
    {
      id: 'realtime-nodejs-backend-reconnect',
      label: 'Node.js (backend) — Reconnection with backoff',
      codeTemplate: `// npm install ws
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

connect()`,
      secretTokens: ['<YOUR_SERVICE_ACCOUNT_TOKEN>'],
      secretPlaceholderRef: 'Obtain a service-account token via Keycloak client_credentials grant with your client_id and client_secret.'
    },
    {
      id: 'realtime-python-backend-reconnect',
      label: 'Python (backend) — Reconnection with backoff',
      codeTemplate: `# pip install websockets
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

asyncio.run(connect_forever())`,
      secretTokens: ['<YOUR_SERVICE_ACCOUNT_TOKEN>'],
      secretPlaceholderRef: 'Obtain a service-account token via Keycloak client_credentials grant.'
    }
  ],
  'iam-client': [
    {
      id: 'iam-client-credentials-curl',
      label: 'cURL — client_credentials',
      codeTemplate: `curl -X POST '{RESOURCE_EXTRA_B}' \\\n  -H 'content-type: application/x-www-form-urlencoded' \\\n  --data-urlencode 'grant_type=client_credentials' \\\n  --data-urlencode 'client_id={RESOURCE_NAME}' \\\n  --data-urlencode 'client_secret=<CLIENT_SECRET>'`,
      fallbackNotes: ['El token endpoint depende del realm activo; si no está resuelto en la consola, se muestra como placeholder descriptivo.'],
      secretTokens: ['<CLIENT_SECRET>'],
      secretPlaceholderRef: IAM_SECRET_REF
    }
  ]
}
