import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFlowExecution, type FlowExecutionState } from './use-flow-execution'

// Controllable fetch/ReadableStream harness: the hook still exercises the real
// subscribeFlowExecution path while tests choose when each named SSE frame arrives.
class ControllableSseReader {
  private queued: Uint8Array[] = []
  private pending: ((value: { done: false; value: Uint8Array }) => void) | null = null

  read(): Promise<{ done: false; value: Uint8Array }> {
    const value = this.queued.shift()
    if (value) return Promise.resolve({ done: false, value })
    return new Promise((resolve) => { this.pending = resolve })
  }

  emit(type: string, data: unknown): void {
    const value = new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
    if (this.pending) {
      const resolve = this.pending
      this.pending = null
      resolve({ done: false, value })
    } else {
      this.queued.push(value)
    }
  }
}

let reader: ControllableSseReader
let requestSignal: AbortSignal | undefined
beforeEach(() => {
  reader = new ControllableSseReader()
  vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    requestSignal = init?.signal ?? undefined
    return Promise.resolve({ ok: true, body: { getReader: () => reader } })
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Harness({ onState }: { onState: (state: FlowExecutionState) => void }) {
  const state = useFlowExecution({ workspaceId: 'ws1', executionId: 'ten:ws1:flow:run-1', apiKey: 'flc_anon' })
  onState(state)
  return null
}

describe('useFlowExecution', () => {
  it('accumulates node-status events from fetch SSE into a per-node map (latest wins)', async () => {
    let latest: FlowExecutionState | null = null
    render(<Harness onState={(s) => (latest = s)} />)
    await act(async () => {
      reader.emit('node-status', { type: 'node-status', nodeId: 'step-1', status: 'scheduled', attemptNumber: 1 })
      reader.emit('node-status', { type: 'node-status', nodeId: 'step-1', status: 'started', attemptNumber: 1 })
      reader.emit('node-status', { type: 'node-status', nodeId: 'step-2', status: 'scheduled' })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(latest!.nodeStatuses.get('step-1')?.status).toBe('started')
    expect(latest!.nodeStatuses.get('step-2')?.status).toBe('scheduled')
  })

  it('marks the run ended and aborts the fetch stream on stream-end', async () => {
    let latest: FlowExecutionState | null = null
    render(<Harness onState={(s) => (latest = s)} />)
    await act(async () => {
      reader.emit('stream-end', { type: 'stream-end', status: 'Completed' })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(latest!.ended).toBe(true)
    expect(requestSignal?.aborted).toBe(true)
  })

  it('aborts the fetch stream on unmount and dispatches no state update afterward', async () => {
    const states: FlowExecutionState[] = []
    const { unmount } = render(<Harness onState={(s) => states.push(s)} />)
    const countBeforeUnmount = states.length
    unmount()
    expect(requestSignal?.aborted).toBe(true)
    // A late frame from an in-flight fetch reader must NOT trigger a state update.
    await act(async () => {
      reader.emit('node-status', { type: 'node-status', nodeId: 'late', status: 'completed' })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(states.length).toBe(countBeforeUnmount)
  })
})
