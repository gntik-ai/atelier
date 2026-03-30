import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RealtimeSession } from '../../../../tests/e2e/realtime/helpers/client.mjs';

class MockWebSocket extends EventEmitter {
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    MockWebSocket.instances.push(this);
    setImmediate(() => this.emit('open'));
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.emit('close', 1000, 'closed');
  }

  pushMessage(payload) {
    this.emit('message', Buffer.from(JSON.stringify(payload)));
  }
}

test('buffer accumulates messages in order', async () => {
  const session = new RealtimeSession({ endpoint: 'ws://example.test/realtime', token: 't1', WebSocketImpl: MockWebSocket });
  await session.connect();
  session._ws.pushMessage({ id: 1 });
  session._ws.pushMessage({ id: 2 });
  assert.deepEqual(session.events.map((event) => event.id), [1, 2]);
});

test('waitForEvent resolves when matching event arrives', async () => {
  const session = new RealtimeSession({ endpoint: 'ws://example.test/realtime', token: 't2', WebSocketImpl: MockWebSocket });
  await session.connect();
  const promise = session.waitForEvent((event) => event.type === 'ready', { maxWaitMs: 100, intervalMs: 10 });
  setTimeout(() => session._ws.pushMessage({ type: 'ready' }), 20);
  const event = await promise;
  assert.equal(event.type, 'ready');
});

test('waitForEvent rejects on timeout if no event arrives', async () => {
  const session = new RealtimeSession({ endpoint: 'ws://example.test/realtime', token: 't3', WebSocketImpl: MockWebSocket });
  await session.connect();
  await assert.rejects(
    () => session.waitForEvent((event) => event.type === 'never', { maxWaitMs: 50, intervalMs: 10 }),
    /poll timed out/
  );
});

test('drainEvents collects exactly n events', async () => {
  const session = new RealtimeSession({ endpoint: 'ws://example.test/realtime', token: 't4', WebSocketImpl: MockWebSocket });
  await session.connect();
  setTimeout(() => {
    session._ws.pushMessage({ id: 'a' });
    session._ws.pushMessage({ id: 'b' });
    session._ws.pushMessage({ id: 'c' });
  }, 20);
  const events = await session.drainEvents(2, { maxWaitMs: 100, intervalMs: 10 });
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.id), ['a', 'b']);
});

test('reconnect clears the buffer', async () => {
  const session = new RealtimeSession({ endpoint: 'ws://example.test/realtime', token: 't5', WebSocketImpl: MockWebSocket });
  await session.connect();
  session._ws.pushMessage({ id: 'before' });
  assert.equal(session.events.length, 1);
  await session.reconnect({ token: 't6' });
  assert.equal(session.events.length, 0);
  assert.equal(session.token, 't6');
});
