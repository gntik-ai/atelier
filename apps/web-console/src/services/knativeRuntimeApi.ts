// Shared client contract for the operator/read-only Knative status route. UI presentation is owned
// by the later UX slice; keeping this transport-only module here lets that slice consume the same
// generated/public contract without duplicating enums or exposing a mutation method.
import { requestConsoleSessionJson } from '@/lib/console-session'

export type KnativeRuntimeMode = 'managed' | 'external' | 'disabled'
export type KnativeCompatibility = 'compatible' | 'incompatible' | 'unverified'
export type KnativeReadinessState = 'ready' | 'unverified' | 'degraded' | 'unavailable' | 'disabled'
export type KnativeReadinessStage =
  | 'configured'
  | 'preflight'
  | 'crds'
  | 'webhook'
  | 'serving'
  | 'kourier'
  | 'smoke'
  | 'ready'
  | 'disabled'
  | 'external_validation'
  | 'unknown'

export interface KnativeRuntimeStatus {
  mode: KnativeRuntimeMode
  owner: string
  version: string | null
  compatibility: KnativeCompatibility
  state: KnativeReadinessState
  stage: KnativeReadinessStage
  reason: string
  lastTransitionAt: string | null
}

export function getKnativeRuntimeStatus(signal?: AbortSignal): Promise<KnativeRuntimeStatus> {
  return requestConsoleSessionJson<KnativeRuntimeStatus>('/v1/platform/runtime/knative', { signal })
}
