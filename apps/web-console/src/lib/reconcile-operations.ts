import type { OperationStatus, OperationSummary } from './console-operations'
import type { TerminalOperationStatus } from './generated/async-operation-status-vocabulary.mjs'

import { reconcileOperations as reconcileOperationsRuntime, TERMINAL_STATUSES as TERMINAL_STATUSES_RUNTIME } from './reconcile-operations.runtime.mjs'

export type TerminalStatus = TerminalOperationStatus

export const TERMINAL_STATUSES: ReadonlySet<OperationStatus> = TERMINAL_STATUSES_RUNTIME as ReadonlySet<OperationStatus>

export interface ReconciliationDelta {
  updated: OperationSummary[]
  added: OperationSummary[]
  terminal: OperationSummary[]
  unavailable: string[]
  unchanged: OperationSummary[]
}

export const reconcileOperations = reconcileOperationsRuntime as (
  localSnapshot: ReadonlyMap<string, OperationSummary>,
  remoteOps: readonly OperationSummary[]
) => ReconciliationDelta
