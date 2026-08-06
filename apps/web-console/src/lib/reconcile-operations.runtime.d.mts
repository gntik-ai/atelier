import type { OperationSummary } from './console-operations'
import type { TerminalOperationStatus } from './generated/async-operation-status-vocabulary.mjs'

export const TERMINAL_STATUSES: ReadonlySet<TerminalOperationStatus>

export function reconcileOperations(
  localSnapshot: ReadonlyMap<string, OperationSummary>,
  remoteOps: readonly OperationSummary[]
): {
  updated: OperationSummary[]
  added: OperationSummary[]
  terminal: OperationSummary[]
  unavailable: string[]
  unchanged: OperationSummary[]
}
