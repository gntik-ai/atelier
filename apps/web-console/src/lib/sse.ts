import { API_VERSION, createRequestId, publicApiFetch } from './http'

export interface SseSubscription { close: () => void }

const DEFAULT_RETRY_MS = 3_000

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timeout = setTimeout(done, delayMs)
    signal.addEventListener('abort', done, { once: true })
  })
}

/** Header-capable, reconnecting SSE transport that preserves EventSource-style named events. */
export function subscribeSse(url: string, handlers: Record<string, (data: string) => void>, onError?: (event: Event) => void): SseSubscription {
  const controller = new AbortController()
  const correlationId = createRequestId('corr')
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined
  void (async () => {
    let lastEventId: string | undefined
    let retryMs = DEFAULT_RETRY_MS
    while (!controller.signal.aborted) {
      try {
        const headers: Record<string, string> = {
          Accept: 'text/event-stream',
          'X-API-Version': API_VERSION,
          'X-Correlation-Id': correlationId
        }
        if (lastEventId) headers['Last-Event-ID'] = lastEventId
        const response = await publicApiFetch(url, { headers, signal: controller.signal })
        if (controller.signal.aborted) break
        if (!response.ok || !response.body) throw new Error(`SSE request failed (${response.status})`)
        const reader = response.body.getReader()
        activeReader = reader
        try {
          const decoder = new TextDecoder()
          let buffer = ''
          while (!controller.signal.aborted) {
            const next = await reader.read()
            if (controller.signal.aborted) break
            if (next.done) break
            buffer += decoder.decode(next.value, { stream: true })
            const frames = buffer.split(/\r?\n\r?\n/)
            buffer = frames.pop() ?? ''
            for (const frame of frames) {
              if (controller.signal.aborted) break
              let event = 'message'
              const data: string[] = []
              for (const rawLine of frame.split(/\r?\n/)) {
                const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
                if (line.startsWith('event:')) event = line.slice(6).trimStart()
                else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
                else if (line.startsWith('id:')) lastEventId = line.slice(3).trimStart()
                else if (line.startsWith('retry:')) {
                  const parsed = Number(line.slice(6).trim())
                  if (Number.isInteger(parsed) && parsed >= 0) retryMs = parsed
                }
              }
              if (data.length > 0 && !controller.signal.aborted) handlers[event]?.(data.join('\n'))
            }
          }
        } finally {
          if (activeReader === reader) activeReader = undefined
          reader.releaseLock?.()
        }
      } catch (error) {
        if (!controller.signal.aborted) onError?.(error as Event)
      }
      if (!controller.signal.aborted) await waitForRetry(retryMs, controller.signal)
    }
  })()
  return {
    close: () => {
      controller.abort()
      const cancellation = activeReader?.cancel?.()
      void cancellation?.catch(() => {})
    }
  }
}
