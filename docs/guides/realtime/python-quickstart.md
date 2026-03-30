# Python Realtime Quick Start

## Prerequisites

- Python 3.10+.
- `websockets` package installed.
- Service account token for the workspace.

## Asyncio note

Use `asyncio.run()` on Python 3.10+ to bootstrap the event loop for your subscription worker.

## Endpoint discovery

Find the realtime endpoint in the console under workspace Settings → Realtime or via `GET /api/workspaces/{workspaceId}/config`.

## Basic subscription

```python
# pip install websockets
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

asyncio.run(subscribe())
```

## Applying filters

```python
# pip install websockets
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

asyncio.run(subscribe())
```

## Reconnection with backoff

```python
# pip install websockets
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

asyncio.run(connect_forever())
```

## Common error codes

| Code | Meaning | Resolution |
|------|---------|-----------|
| 4001 | `token_expired` | Rotate the service-account token and reconnect |
| 4003 | `scope_denied` | Verify the service account has `realtime:subscribe` scope |
| 4008 | `quota_exceeded` | Reduce concurrent subscribers or request a quota increase |
| 4010 | `channel_unavailable` | Provision the requested channel type in the workspace |
