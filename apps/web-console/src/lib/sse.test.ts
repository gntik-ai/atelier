import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeSse } from './sse'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('header-capable SSE adapter', () => {
  it('sends contract headers and parses named events across chunks', async () => {
    const read = vi.fn()
    read.mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('event: insert\ndata: {"a":') })
      .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('1}\n\nevent: update\ndata: bad\n\n') })
      .mockResolvedValueOnce({ done: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => ({ read }), }, }))
    const events: string[] = []; const sub = subscribeSse('/events', { insert: (d) => events.push(d), update: (d) => events.push(d) })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetch).toHaveBeenCalledWith('/events', expect.any(Object))
    const headers = new Headers(vi.mocked(fetch).mock.calls[0]?.[1]?.headers)
    expect(headers.get('accept')).toBe('text/event-stream')
    expect(headers.get('x-api-version')).toBe('2026-03-26')
    expect(headers.get('x-correlation-id')).toMatch(/^[A-Za-z0-9._:-]{8,128}$/)
    expect(events).toEqual(['{"a":1}', 'bad']); sub.close()
  })

  it('reports transport errors and aborts on close', async () => {
    const onError = vi.fn(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const sub = subscribeSse('/events', {}, onError); await new Promise((resolve) => setTimeout(resolve, 0)); expect(onError).toHaveBeenCalled(); sub.close()
    expect((vi.mocked(fetch).mock.calls[0]?.[1]?.signal as AbortSignal).aborted).toBe(true)
  })

  it('does not dispatch a frame that resolves after the subscription closes', async () => {
    let resolveRead: (value: { done: false; value: Uint8Array }) => void = () => {}
    const pendingRead = new Promise<{ done: false; value: Uint8Array }>((resolve) => {
      resolveRead = resolve
    })
    const cancel = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: () => pendingRead, cancel }) }
    }))
    const onInsert = vi.fn()
    const subscription = subscribeSse('/events', { insert: onInsert })
    await new Promise((resolve) => setTimeout(resolve, 0))

    subscription.close()
    resolveRead({ done: false, value: new TextEncoder().encode('event: insert\ndata: late\n\n') })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onInsert).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('does not dispatch frames trailing a terminal handler that closes the stream', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('event: stream-end\ndata: done\n\nevent: insert\ndata: late\n\n') })
      .mockImplementation(() => new Promise(() => {}))
    const cancel = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read, cancel }) }
    }))
    const onInsert = vi.fn()
    let subscription: ReturnType<typeof subscribeSse>
    subscription = subscribeSse('/events', {
      'stream-end': () => subscription.close(),
      insert: onInsert
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onInsert).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('reconnects with Last-Event-ID while retaining the subscription correlation', async () => {
    const firstRead = vi.fn()
      .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('id: 42\nretry: 1\nevent: insert\ndata: one\n\n') })
      .mockResolvedValueOnce({ done: true })
    const secondRead = vi.fn().mockImplementation(() => new Promise(() => {}))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, body: { getReader: () => ({ read: firstRead }) } })
      .mockResolvedValueOnce({ ok: true, body: { getReader: () => ({ read: secondRead }) } })
    vi.stubGlobal('fetch', fetchMock)

    const events: string[] = []
    const sub = subscribeSse('/events', { insert: (data) => events.push(data) })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(events).toEqual(['one'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    const secondHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers)
    expect(secondHeaders.get('last-event-id')).toBe('42')
    expect(secondHeaders.get('x-correlation-id')).toBe(firstHeaders.get('x-correlation-id'))
    sub.close()
  })
})
