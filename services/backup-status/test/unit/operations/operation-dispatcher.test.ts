import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before importing dispatcher
vi.mock('../../../src/operations/operations.repository.js', () => ({
  findById: vi.fn(),
  updateStatus: vi.fn(),
}))

vi.mock('../../../src/adapters/registry.js', () => ({
  adapterRegistry: { get: vi.fn() },
  isActionAdapter: vi.fn(),
}))

import * as repo from '../../../src/operations/operations.repository.js'
import { adapterRegistry, isActionAdapter } from '../../../src/adapters/registry.js'
import { dispatch } from '../../../src/operations/operation-dispatcher.js'
import type { OperationRecord } from '../../../src/operations/operations.types.js'

const mockFindById = vi.mocked(repo.findById)
const mockUpdateStatus = vi.mocked(repo.updateStatus)
const mockGet = vi.mocked(adapterRegistry.get)
const mockIsAction = vi.mocked(isActionAdapter)

function makeOp(overrides: Partial<OperationRecord> = {}): OperationRecord {
  return {
    id: 'op-1',
    type: 'backup',
    tenantId: 'tenant-a',
    componentType: 'postgresql',
    instanceId: 'pg-main',
    status: 'accepted',
    requesterId: 'user-1',
    requesterRole: 'sre',
    snapshotId: null,
    failureReason: null,
    failureReasonPublic: null,
    adapterOperationId: null,
    acceptedAt: new Date('2026-01-01T00:00:00Z'),
    inProgressAt: null,
    completedAt: null,
    failedAt: null,
    metadata: null,
    ...overrides,
  }
}

describe('OperationDispatcher.dispatch()', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockUpdateStatus.mockResolvedValue(null)
  })

  it('transitions accepted → in_progress → completed on adapter success', async () => {
    mockFindById.mockResolvedValue(makeOp())
    const adapter = {
      componentType: 'postgresql',
      instanceLabel: 'pg',
      check: vi.fn(),
      capabilities: () => ({ triggerBackup: true, triggerRestore: true, listSnapshots: true }),
      triggerBackup: vi.fn().mockResolvedValue({ adapterOperationId: 'k8s-backup-1' }),
      triggerRestore: vi.fn(),
      listSnapshots: vi.fn(),
    }
    mockGet.mockReturnValue(adapter)
    mockIsAction.mockReturnValue(true)

    await dispatch('op-1')

    expect(mockUpdateStatus).toHaveBeenCalledWith('op-1', 'in_progress')
    expect(adapter.triggerBackup).toHaveBeenCalled()
    expect(mockUpdateStatus).toHaveBeenCalledWith('op-1', 'completed', { adapterOperationId: 'k8s-backup-1' })
  })

  it('transitions accepted → in_progress → failed on adapter error', async () => {
    mockFindById.mockResolvedValue(makeOp())
    const adapter = {
      componentType: 'postgresql',
      instanceLabel: 'pg',
      check: vi.fn(),
      capabilities: () => ({ triggerBackup: true, triggerRestore: true, listSnapshots: true }),
      triggerBackup: vi.fn().mockRejectedValue(new Error('K8s API returned 500')),
      triggerRestore: vi.fn(),
      listSnapshots: vi.fn(),
    }
    mockGet.mockReturnValue(adapter)
    mockIsAction.mockReturnValue(true)

    await dispatch('op-1')

    expect(mockUpdateStatus).toHaveBeenCalledWith('op-1', 'in_progress')
    expect(mockUpdateStatus).toHaveBeenCalledWith('op-1', 'failed', expect.objectContaining({
      failureReason: 'K8s API returned 500',
    }))
  })

  it('transitions to failed with adapter_timeout when adapter exceeds timeout', async () => {
    // The dispatcher uses withTimeout internally. We simulate a timeout by having
    // the adapter reject with the same error message the withTimeout helper produces.
    mockFindById.mockResolvedValue(makeOp())
    const adapter = {
      componentType: 'postgresql',
      instanceLabel: 'pg',
      check: vi.fn(),
      capabilities: () => ({ triggerBackup: true, triggerRestore: true, listSnapshots: true }),
      triggerBackup: vi.fn().mockRejectedValue(new Error('adapter_timeout')),
      triggerRestore: vi.fn(),
      listSnapshots: vi.fn(),
    }
    mockGet.mockReturnValue(adapter)
    mockIsAction.mockReturnValue(true)

    await dispatch('op-1')

    expect(mockUpdateStatus).toHaveBeenCalledWith('op-1', 'failed', expect.objectContaining({
      failureReason: 'adapter_timeout',
    }))
  })

  it('sets failure_reason to technical message and failure_reason_public to generic message', async () => {
    mockFindById.mockResolvedValue(makeOp())
    const adapter = {
      componentType: 'postgresql',
      instanceLabel: 'pg',
      check: vi.fn(),
      capabilities: () => ({ triggerBackup: true, triggerRestore: true, listSnapshots: true }),
      triggerBackup: vi.fn().mockRejectedValue(new Error('Connection refused to K8s API')),
      triggerRestore: vi.fn(),
      listSnapshots: vi.fn(),
    }
    mockGet.mockReturnValue(adapter)
    mockIsAction.mockReturnValue(true)

    await dispatch('op-1')

    expect(mockUpdateStatus).toHaveBeenCalledWith('op-1', 'failed', {
      failureReason: 'Connection refused to K8s API',
      failureReasonPublic: 'La operación no pudo completarse. Contacte al administrador.',
    })
  })

  it('emits Kafka event on completion', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockFindById.mockResolvedValue(makeOp())
    const adapter = {
      componentType: 'postgresql',
      instanceLabel: 'pg',
      check: vi.fn(),
      capabilities: () => ({ triggerBackup: true, triggerRestore: true, listSnapshots: true }),
      triggerBackup: vi.fn().mockResolvedValue({ adapterOperationId: 'bk-1' }),
      triggerRestore: vi.fn(),
      listSnapshots: vi.fn(),
    }
    mockGet.mockReturnValue(adapter)
    mockIsAction.mockReturnValue(true)

    await dispatch('op-1')

    const kafkaLog = consoleSpy.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('kafka') && typeof c[1] === 'string' && c[1].includes('completed'),
    )
    expect(kafkaLog).toBeDefined()
    consoleSpy.mockRestore()
  })

  it('emits Kafka event on failure', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockFindById.mockResolvedValue(makeOp())
    const adapter = {
      componentType: 'postgresql',
      instanceLabel: 'pg',
      check: vi.fn(),
      capabilities: () => ({ triggerBackup: true, triggerRestore: true, listSnapshots: true }),
      triggerBackup: vi.fn().mockRejectedValue(new Error('fail')),
      triggerRestore: vi.fn(),
      listSnapshots: vi.fn(),
    }
    mockGet.mockReturnValue(adapter)
    mockIsAction.mockReturnValue(true)

    await dispatch('op-1')

    const kafkaLog = consoleSpy.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('kafka') && typeof c[1] === 'string' && c[1].includes('failed'),
    )
    expect(kafkaLog).toBeDefined()
    consoleSpy.mockRestore()
  })

  it('does not re-dispatch if operation is already in_progress', async () => {
    mockFindById.mockResolvedValue(makeOp({ status: 'in_progress' }))

    await dispatch('op-1')

    expect(mockUpdateStatus).not.toHaveBeenCalled()
  })
})
