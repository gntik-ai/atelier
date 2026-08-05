import { TERMINAL_STATUS_SET } from './generated/async-operation-status-vocabulary.mjs'

export const TERMINAL_STATUSES = TERMINAL_STATUS_SET

export function reconcileOperations(localSnapshot, remoteOps) {
  const remoteMap = new Map(remoteOps.map((operation) => [operation.operationId, operation]))
  const updated = []
  const added = []
  const terminal = []
  const unavailable = []
  const unchanged = []

  for (const [operationId, localOperation] of localSnapshot.entries()) {
    const remoteOperation = remoteMap.get(operationId)

    if (!remoteOperation) {
      unavailable.push(operationId)
      continue
    }

    if (remoteOperation.status !== localOperation.status) {
      updated.push(remoteOperation)
      if (TERMINAL_STATUSES.has(remoteOperation.status)) {
        terminal.push(remoteOperation)
      }
      continue
    }

    unchanged.push(remoteOperation)
  }

  for (const remoteOperation of remoteOps) {
    if (!localSnapshot.has(remoteOperation.operationId)) {
      added.push(remoteOperation)
    }
  }

  return { updated, added, terminal, unavailable, unchanged }
}
