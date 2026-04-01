import { describe, it, expect, vi, beforeEach } from 'vitest'

// We test the exported postgresqlAdapter from the adapter module
// Mock global fetch for K8s API calls
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Dynamic import after mocking fetch
const { postgresqlAdapter } = await import('../../../src/adapters/postgresql.adapter.js')

const ctx = {
  deploymentProfile: 'standard',
  serviceAccountToken: 'test-token',
  k8sNamespace: 'test-ns',
}

describe('PostgresAdapter actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('capabilities() returns triggerBackup: true (static declaration)', () => {
    const caps = postgresqlAdapter.capabilities()
    expect(caps.triggerBackup).toBe(true)
    expect(caps.triggerRestore).toBe(true)
    expect(caps.listSnapshots).toBe(true)
  })

  it('triggerBackup() creates Backup object in Kubernetes and returns adapterOperationId', async () => {
    // First call: detectCnpgAvailable → ok
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    // Second call: create Backup → ok
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    const result = await postgresqlAdapter.triggerBackup('pg-main', 'tenant-a', ctx)

    expect(result.adapterOperationId).toBeDefined()
    expect(result.adapterOperationId).toContain('backup-pg-main-')
    // Verify K8s API was called to create Backup
    expect(mockFetch).toHaveBeenCalledTimes(2)
    const createCall = mockFetch.mock.calls[1]
    expect(createCall[0]).toContain('/backups')
    expect(createCall[1].method).toBe('POST')
  })

  it('triggerBackup() throws adapter_no_backup_mechanism when CRD not available', async () => {
    // detectCnpgAvailable → not ok
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })

    await expect(
      postgresqlAdapter.triggerBackup('pg-main', 'tenant-a', ctx),
    ).rejects.toThrow('No backup mechanism available')
  })

  it('triggerRestore() creates recovery cluster from snapshotId', async () => {
    // detectCnpgAvailable → ok
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    // create Cluster → ok
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })

    const result = await postgresqlAdapter.triggerRestore('pg-main', 'tenant-a', 'snap-1', ctx)

    expect(result.adapterOperationId).toBeDefined()
    expect(result.adapterOperationId).toContain('pg-main-restore-')
    const createCall = mockFetch.mock.calls[1]
    expect(createCall[0]).toContain('/clusters')
    const body = JSON.parse(createCall[1].body)
    expect(body.spec.bootstrap.recovery.backup.name).toBe('snap-1')
  })

  it('triggerRestore() throws when CRD not available', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })

    await expect(
      postgresqlAdapter.triggerRestore('pg-main', 'tenant-a', 'snap-1', ctx),
    ).rejects.toThrow('No restore mechanism available')
  })

  it('listSnapshots() returns completed backups as available: true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            metadata: { name: 'bk-1', creationTimestamp: '2026-01-01T00:00:00Z' },
            status: { phase: 'completed' },
          },
        ],
      }),
    })

    const snapshots = await postgresqlAdapter.listSnapshots('pg-main', 'tenant-a', ctx)

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].snapshotId).toBe('bk-1')
    expect(snapshots[0].available).toBe(true)
  })

  it('listSnapshots() returns non-completed backups as available: false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            metadata: { name: 'bk-2', creationTimestamp: '2026-01-02T00:00:00Z' },
            status: { phase: 'running' },
          },
        ],
      }),
    })

    const snapshots = await postgresqlAdapter.listSnapshots('pg-main', 'tenant-a', ctx)

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].available).toBe(false)
  })
})
