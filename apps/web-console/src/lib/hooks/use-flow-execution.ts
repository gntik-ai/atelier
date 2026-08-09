// React hook for the flow run view's live SSE subscription (change: add-console-flow-monitoring).
//
// Opens the header-capable execution-events fetch stream on mount, accumulates node-status events into a
// Map<nodeId, NodeStatusSnapshot> (latest-wins per node), buffers log-line frames per node, and
// closes the subscription on unmount. A `stream-end` frame marks the run terminal and closes the
// stream (the run view then renders statically from accumulated history). Mirrors the
// subscribe/close discipline of use-reconnect-state-sync.ts + realtimeApi.ts.
//
// Guard: no state update is dispatched after unmount (a late frame from an in-flight fetch reader
// is dropped) — the spec scenario "SSE hook closes subscription on unmount".
import { useEffect, useRef, useState } from 'react'

import {
  subscribeFlowExecution,
  type FlowExecutionEvent,
  type LogLineEvent,
  type NodeStatus,
  type NodeStatusEvent
} from '@/services/flowsMonitoringApi'

export interface NodeStatusSnapshot {
  nodeId: string
  status: NodeStatus
  attemptNumber: number
  startedAt?: string | null
  completedAt?: string | null
  error?: { message: string; stack?: string } | null
}

export interface FlowExecutionState {
  // Latest status per node id (the badge source). Iterates in insertion order.
  nodeStatuses: Map<string, NodeStatusSnapshot>
  // Log lines accumulated per node id (chronological).
  logsByNode: Map<string, LogLineEvent[]>
  // True once a stream-end frame arrives → the run reached a terminal state.
  ended: boolean
  // True while the fetch-backed SSE stream has emitted no error.
  streaming: boolean
}

export interface UseFlowExecutionParams {
  workspaceId: string
  executionId: string
  apiKey: string
  // Defaults true; pass false for an already-terminal run rendered statically from the detail
  // endpoint (no live stream needed — the spec's "completed run rendered from history" path).
  enabled?: boolean
  origin?: string
}

function applyNodeStatus(
  map: Map<string, NodeStatusSnapshot>,
  event: NodeStatusEvent
): Map<string, NodeStatusSnapshot> {
  const next = new Map(map)
  const prev = next.get(event.nodeId)
  next.set(event.nodeId, {
    nodeId: event.nodeId,
    status: event.status,
    attemptNumber: event.attemptNumber ?? prev?.attemptNumber ?? 1,
    startedAt: event.startedAt ?? prev?.startedAt ?? null,
    completedAt: event.completedAt ?? prev?.completedAt ?? null,
    error: event.error ?? prev?.error ?? null
  })
  return next
}

export function useFlowExecution(params: UseFlowExecutionParams): FlowExecutionState {
  const { workspaceId, executionId, apiKey, enabled = true, origin } = params

  const [nodeStatuses, setNodeStatuses] = useState<Map<string, NodeStatusSnapshot>>(new Map())
  const [logsByNode, setLogsByNode] = useState<Map<string, LogLineEvent[]>>(new Map())
  const [ended, setEnded] = useState(false)
  const [streaming, setStreaming] = useState(false)

  // Tracks mount state so a frame arriving after unmount never dispatches a state update.
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    if (!enabled || !executionId || !apiKey) {
      return () => {
        mountedRef.current = false
      }
    }

    setStreaming(true)
    const subscription = subscribeFlowExecution({
      workspaceId,
      executionId,
      apiKey,
      origin,
      onEvent: (event: FlowExecutionEvent) => {
        if (!mountedRef.current) return
        if (event.type === 'node-status') {
          setNodeStatuses((current) => applyNodeStatus(current, event))
        } else if (event.type === 'log-line') {
          setLogsByNode((current) => {
            const next = new Map(current)
            const list = next.get(event.nodeId) ?? []
            next.set(event.nodeId, [...list, event])
            return next
          })
        } else if (event.type === 'stream-end') {
          setEnded(true)
          setStreaming(false)
          subscription.close()
        }
      },
      onError: () => {
        if (!mountedRef.current) return
        setStreaming(false)
      }
    })

    return () => {
      mountedRef.current = false
      subscription.close()
    }
  }, [workspaceId, executionId, apiKey, enabled, origin])

  return { nodeStatuses, logsByNode, ended, streaming }
}
