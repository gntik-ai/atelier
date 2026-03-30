import { WebSocket } from 'ws';
import { poll } from './poller.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RealtimeSession {
  constructor({ endpoint, token, WebSocketImpl = WebSocket } = {}) {
    if (!endpoint) {
      throw new Error('REALTIME endpoint is required');
    }
    if (!token) {
      throw new Error('Realtime token is required');
    }

    this.endpoint = endpoint;
    this.token = token;
    this.WebSocketImpl = WebSocketImpl;
    this._ws = null;
    this._buffer = [];
    this._disconnected = true;
    this._messageWaitMs = 5_000;
    this._suppressNextCloseEvent = false;
  }

  get events() {
    return this._buffer;
  }

  async connect() {
    await this._open(this.token);
    return this;
  }

  async _open(token) {
    const url = new URL(this.endpoint);
    url.searchParams.set('token', token);

    this._disconnected = false;

    await new Promise((resolve, reject) => {
      const ws = new this.WebSocketImpl(url);
      this._ws = ws;

      const cleanup = () => {
        ws.removeEventListener?.('open', onOpen);
        ws.removeEventListener?.('error', onError);
        ws.removeEventListener?.('message', onMessage);
        ws.removeEventListener?.('close', onClose);
        ws.off?.('open', onOpen);
        ws.off?.('error', onError);
        ws.off?.('message', onMessage);
        ws.off?.('close', onClose);
      };

      const onOpen = () => resolve();
      const onError = (error) => reject(error instanceof Error ? error : new Error(String(error)));
      const onMessage = (message) => {
        const raw = typeof message?.data === 'string' ? message.data : message?.toString?.() ?? message;
        try {
          const parsed = JSON.parse(raw);
          parsed.receivedAt ??= Date.now();
          this._buffer.push(parsed);
        } catch (error) {
          this._buffer.push({ type: 'parse-error', raw, receivedAt: Date.now(), error: error.message });
        }
      };
      const onClose = (code, reason) => {
        this._disconnected = true;
        if (this._suppressNextCloseEvent) {
          this._suppressNextCloseEvent = false;
          return;
        }
        this._buffer.push({ type: 'connection-closed', code, reason: reason?.toString?.() ?? reason, receivedAt: Date.now() });
      };

      if (ws.addEventListener) {
        ws.addEventListener('open', onOpen);
        ws.addEventListener('error', onError);
        ws.addEventListener('message', onMessage);
        ws.addEventListener('close', onClose);
      } else {
        ws.on('open', onOpen);
        ws.on('error', onError);
        ws.on('message', onMessage);
        ws.on('close', onClose);
      }

      ws.once?.('open', () => cleanup());
      ws.once?.('error', () => cleanup());
    });

    this._attachRuntimeListeners();
  }

  _attachRuntimeListeners() {
    const ws = this._ws;
    if (!ws) {
      return;
    }

    const onMessage = (message) => {
      const raw = typeof message?.data === 'string' ? message.data : message?.toString?.() ?? message;
      try {
        const parsed = JSON.parse(raw);
        parsed.receivedAt ??= Date.now();
        this._buffer.push(parsed);
      } catch (error) {
        this._buffer.push({ type: 'parse-error', raw, receivedAt: Date.now(), error: error.message });
      }
    };

    const onClose = (code, reason) => {
      this._disconnected = true;
      if (this._suppressNextCloseEvent) {
        this._suppressNextCloseEvent = false;
        return;
      }
      this._buffer.push({ type: 'connection-closed', code, reason: reason?.toString?.() ?? reason, receivedAt: Date.now() });
    };

    if (ws.addEventListener) {
      ws.addEventListener('message', onMessage);
      ws.addEventListener('close', onClose);
    } else {
      ws.on('message', onMessage);
      ws.on('close', onClose);
    }
  }

  send(payload) {
    if (!this._ws || this._disconnected) {
      throw new Error('Realtime session is not connected');
    }
    this._ws.send(JSON.stringify(payload));
  }

  async subscribe({ workspaceId, channelId, filter } = {}) {
    const requestId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.send({ type: 'subscribe', requestId, workspaceId, channelId, filter });

    const confirmation = await this.waitForEvent(
      (event) => event.type === 'subscription-confirmed' && event.requestId === requestId,
      { maxWaitMs: this._messageWaitMs }
    );

    return { subscriptionId: confirmation.subscriptionId };
  }

  async refreshToken(token) {
    this.token = token;
    this.send({ type: 'refresh-token', token });
    return this.waitForEvent((event) => event.type === 'token-refreshed', { maxWaitMs: this._messageWaitMs });
  }

  async waitForEvent(matchFn, opts = {}) {
    let matched;
    await poll(() => {
      matched = this._buffer.find(matchFn);
      if (!matched) {
        throw new Error('matching event not observed yet');
      }
    }, opts);
    return matched;
  }

  async drainEvents(n, opts = {}) {
    const drained = [];
    let cursor = 0;
    await poll(() => {
      while (cursor < this._buffer.length && drained.length < n) {
        drained.push(this._buffer[cursor]);
        cursor += 1;
      }
      if (drained.length < n) {
        throw new Error(`expected ${n} events, got ${drained.length}`);
      }
    }, opts);
    return drained;
  }

  disconnect() {
    this._disconnected = true;
    this._suppressNextCloseEvent = true;
    this._ws?.close();
  }

  async reconnect({ token } = {}) {
    this._buffer.length = 0;
    this.disconnect();
    await sleep(25);
    if (token) {
      this.token = token;
    }
    await this._open(this.token);
  }
}

export async function createRealtimeClient({ endpoint, token, WebSocketImpl } = {}) {
  const session = new RealtimeSession({ endpoint, token, WebSocketImpl });
  return session.connect();
}

export default createRealtimeClient;
