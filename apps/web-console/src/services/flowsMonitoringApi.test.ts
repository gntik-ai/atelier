import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  flowExecutionEventsUrl,
  isTerminalExecution,
  subscribeFlowExecution,
  type FlowExecutionEvent
} from './flowsMonitoringApi'

const streamResponse = (...chunks: string[]) => {
  const read = vi.fn()
  for (const chunk of chunks) read.mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(chunk) })
  read.mockResolvedValueOnce({ done: true })
  return { ok: true, body: { getReader: () => ({ read }) } }
}
beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

describe('flowsMonitoringApi', () => {
  it('builds the execution SSE URL with the anon key as ?apikey=', () => {
    const url = flowExecutionEventsUrl({
      workspaceId: 'ws1',
      executionId: 'ten:ws1:flow:run-1',
      apiKey: 'flc_anon_x',
      origin: 'https://api.example.com'
    })
    expect(url).toBe(
      'https://api.example.com/v1/flows/workspaces/ws1/executions/ten%3Aws1%3Aflow%3Arun-1/events?apikey=flc_anon_x'
    )
  })

  it('subscribes over fetch SSE, dispatches named events and preserves the API key URL', async () => {
    vi.mocked(fetch).mockResolvedValue(streamResponse(
      'event: node-status\ndata: {"type":"node-status","nodeId":"step-1","status":"started","attemptNumber":1}\n\n',
      'event: log-line\ndata: {"type":"log-line","nodeId":"step-1","level":"info","message":"hello"}\n\n',
      'event: stream-end\ndata: {"type":"stream-end","status":"Completed"}\n\n'
    ) as unknown as Response)
    const events: FlowExecutionEvent[] = []
    const sub = subscribeFlowExecution({
      workspaceId: 'ws1',
      executionId: 'ten:ws1:flow:run-1',
      apiKey: 'flc_anon_x',
      onEvent: (event) => events.push(event)
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('apikey=flc_anon_x'), expect.any(Object))
    const headers = new Headers(vi.mocked(fetch).mock.calls[0]?.[1]?.headers)
    expect(headers.get('x-api-version')).toBe('2026-03-26')
    expect(headers.get('x-correlation-id')).toMatch(/^[A-Za-z0-9._:-]{8,128}$/)
    expect(events).toEqual([
      { type: 'node-status', nodeId: 'step-1', status: 'started', attemptNumber: 1 },
      { type: 'log-line', nodeId: 'step-1', level: 'info', message: 'hello' },
      { type: 'stream-end', status: 'Completed' }
    ]); sub.close()
  })

  it('ignores malformed frames and reports errors', async () => {
    const events: FlowExecutionEvent[] = []; const onError = vi.fn()
    vi.mocked(fetch).mockResolvedValue(streamResponse('event: node-status\ndata: {bad\n\n') as unknown as Response)
    const sub = subscribeFlowExecution({
      workspaceId: 'ws1',
      executionId: 'e1',
      apiKey: 'k',
      onEvent: (event) => events.push(event), onError
    })
    await new Promise((resolve) => setTimeout(resolve, 0)); expect(events).toEqual([]); sub.close()
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline')); subscribeFlowExecution({ workspaceId: 'ws1', executionId: 'e1', apiKey: 'k', onEvent: () => {}, onError })
    await new Promise((resolve) => setTimeout(resolve, 0)); expect(onError).toHaveBeenCalled()
  })

  it('isTerminalExecution recognises terminal Temporal statuses', () => {
    expect(isTerminalExecution('Running')).toBe(false)
    expect(isTerminalExecution(null)).toBe(false)
    expect(isTerminalExecution('Completed')).toBe(true)
    expect(isTerminalExecution('Failed')).toBe(true)
    expect(isTerminalExecution('Canceled')).toBe(true)
    expect(isTerminalExecution('TimedOut')).toBe(true)
  })
})
